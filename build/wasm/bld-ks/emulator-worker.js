// Web Worker for KLH10 PDP-10 Emulator
console.log('Worker script loaded successfully');

// Ring Buffer Manager for shared memory communication
class RingBufferManager {
    constructor(sharedBuffer, baseOffset = 0) {
        this.buffer = new Uint8Array(sharedBuffer);
        this.view = new DataView(sharedBuffer);
        
        // Buffer layout:
        // Input ring buffer: offset 0, size 4112 (4096 data + 16 metadata)
        // Output ring buffer: offset 4112, size 4112 (4096 data + 16 metadata)  
        // Control: offset 8224, size 16 (mode + flush_request + padding)
        
        this.baseOffset = baseOffset;
        this.inputOffset = baseOffset;
        this.outputOffset = baseOffset + 4112;
        this.controlOffset = baseOffset + 8224;
    }
    
    // Input ring buffer (JavaScript writes, WASM reads)
    writeInputChar(char) {
        const writePos = this.view.getUint32(this.inputOffset, true);
        const readPos = this.view.getUint32(this.inputOffset + 4, true);
        const size = 4096;
        
        const nextWritePos = (writePos + 1) % size;
        if (nextWritePos === readPos) {
            return false; // Buffer full
        }
        
        this.buffer[this.inputOffset + 16 + writePos] = char.charCodeAt(0);
        this.view.setUint32(this.inputOffset, nextWritePos, true);
        return true;
    }
    
    writeInputLine(line) {
        // Write each character followed by newline
        for (let i = 0; i < line.length; i++) {
            if (!this.writeInputChar(line[i])) {
                return false; // Buffer full
            }
        }
        // Add newline to complete the line
        return this.writeInputChar('\n');
    }
    
    // Output ring buffer (WASM writes, JavaScript reads)
    readOutputChar() {
        const writePos = this.view.getUint32(this.outputOffset, true);
        const readPos = this.view.getUint32(this.outputOffset + 4, true);
        
        if (readPos === writePos) {
            return null; // Buffer empty
        }
        
        const char = this.buffer[this.outputOffset + 16 + readPos];
        const nextReadPos = (readPos + 1) % 4096;
        this.view.setUint32(this.outputOffset + 4, nextReadPos, true);
        
        return String.fromCharCode(char);
    }
    
    hasOutputData() {
        const writePos = this.view.getUint32(this.outputOffset, true);
        const readPos = this.view.getUint32(this.outputOffset + 4, true);
        return readPos !== writePos;
    }
    
    // Output ring buffer (WASM writes, JavaScript reads) - Worker side writing
    writeOutputChar(char) {
        const writePos = this.view.getUint32(this.outputOffset, true);
        const readPos = this.view.getUint32(this.outputOffset + 4, true);
        const size = 4096;
        
        const nextWritePos = (writePos + 1) % size;
        if (nextWritePos === readPos) {
            return false; // Buffer full
        }
        
        this.buffer[this.outputOffset + 16 + writePos] = char.charCodeAt(0);
        this.view.setUint32(this.outputOffset, nextWritePos, true);
        return true;
    }
    
    // Control functions
    getCurrentMode() {
        return this.view.getUint32(this.controlOffset, true);
    }
    
    getFlushRequest() {
        return this.view.getUint32(this.controlOffset + 4, true);
    }
    
    clearFlushRequest() {
        this.view.setUint32(this.controlOffset + 4, 0, true);
    }
}

class EmulatorWorker {
    constructor() {
        this.Module = null;
        this.isRunning = false;
        
        // Shared WebAssembly memory - set from main thread
        this.wasmMemory = null;
        this.ringBufferBase = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            console.log('Worker: Starting initialization...');
            try {
                // Configure Module to use shared WebAssembly memory
                console.log('Worker: Configuring Module with shared memory:', this.wasmMemory);
                console.log('Worker: Shared memory buffer size:', this.wasmMemory.buffer.byteLength);
                
                self.Module = {
                    // Use the shared memory passed from main thread
                    wasmMemory: this.wasmMemory,
                    // Capture stdout/stderr and write directly to shared ring buffer
                    print: (text) => {
                        // Clean up any invalid UTF-8 characters
                        const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '');
                        
                        // Check if this is a prompt (KLH10# or KLH10> or KLH10>>)
                        const isPrompt = /^KLH10[#>]+\s*$/.test(cleanText.trim());
                        
                        if (isPrompt) {
                            // Prompts should not have newlines added
                            this.writeToWasmOutputRing(cleanText);
                        } else {
                            // Regular output needs newlines added
                            this.writeToWasmOutputRing(cleanText + '\n');
                        }
                    },
                    printErr: (text) => {
                        // Clean up any invalid UTF-8 characters  
                        const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '');
                        // Add newline since Module.print() is line-based and Emscripten strips \n
                        this.writeToWasmOutputRing(cleanText + '\n');
                    },
                    
                    // Handle module ready
                    onRuntimeInitialized: async () => {
                        this.Module = self.Module;
                        
                        // Set up ring buffers in WASM memory IMMEDIATELY before anything else
                        this.setupWasmRingBuffers();
                        
                        // Create empty config file in virtual file system
                        // KLH10 processes each line as a command, so we want an empty file
                        const configContent = ``;
                        
                        try {
                            // Create config file with same name as program (KLH10 default behavior)
                            this.Module.FS.writeFile('/kn10-ks', configContent);
                            
                            // Preload bootstrap tape file if it exists
                            try {
                                const tapeUrl = '/bb-d867e-bm.tap';
                                console.log('Attempting to preload bootstrap tape:', tapeUrl);
                                
                                // Fetch the tape file
                                const response = await fetch(tapeUrl);
                                if (response.ok) {
                                    const arrayBuffer = await response.arrayBuffer();
                                    const uint8Array = new Uint8Array(arrayBuffer);
                                    
                                    // Write to the virtual filesystem
                                    this.Module.FS.writeFile('bb-d867e-bm.tap', uint8Array);
                                    console.log('Bootstrap tape loaded successfully:', uint8Array.length, 'bytes');
                                } else {
                                    console.warn('Could not fetch bootstrap tape file:', response.status);
                                }
                            } catch (e) {
                                console.warn('Error preloading bootstrap tape:', e);
                            }
                            
                            // Preload Emacs tape file if it exists
                            try {
                                const emacsTapeUrl = '/emacs.tap';
                                console.log('Attempting to preload Emacs tape:', emacsTapeUrl);
                                
                                // Fetch the Emacs tape file
                                const emacsResponse = await fetch(emacsTapeUrl);
                                if (emacsResponse.ok) {
                                    const emacsArrayBuffer = await emacsResponse.arrayBuffer();
                                    const emacsUint8Array = new Uint8Array(emacsArrayBuffer);
                                    
                                    // Write to the virtual filesystem
                                    this.Module.FS.writeFile('emacs.tap', emacsUint8Array);
                                    console.log('Emacs tape loaded successfully:', emacsUint8Array.length, 'bytes');
                                } else {
                                    console.warn('Could not fetch Emacs tape file:', emacsResponse.status);
                                }
                            } catch (e) {
                                console.warn('Error preloading Emacs tape:', e);
                            }
                            
                            // Preload bootstrap files if they exist
                            const bootFiles = ['smboot-k.sav', 'smmtbt-k.sav'];
                            for (const bootFile of bootFiles) {
                                try {
                                    const response = await fetch('/' + bootFile);
                                    if (response.ok) {
                                        const arrayBuffer = await response.arrayBuffer();
                                        const uint8Array = new Uint8Array(arrayBuffer);
                                        this.Module.FS.writeFile(bootFile, uint8Array);
                                        console.log('Bootstrap file loaded:', bootFile, uint8Array.length, 'bytes');
                                    }
                                } catch (e) {
                                    // Ignore if bootstrap files don't exist
                                }
                            }
                            
                            // List all files in the virtual filesystem for debugging
                            try {
                                var files = this.Module.FS.readdir('/');
                                console.log('Files in virtual filesystem:', files);
                            } catch (e) {
                                console.warn('Could not list files:', e);
                            }
                        } catch (err) {
                            console.warn('Could not create config file:', err);
                        }
                        
                        this.sendMessage('ready');
                        resolve();
                    },
                    
                    // Handle exit
                    onExit: (code) => {
                        this.isRunning = false;
                        this.sendMessage('exit', code);
                    },
                    
                    // Don't quit on main exit
                    quit: (status, toThrow) => {
                        this.isRunning = false;
                        this.sendMessage('exit', status);
                    },
                    
                    // Disable automatic main execution
                    noInitialRun: true,
                    
                    // Capture errors
                    onAbort: (reason) => {
                        this.sendMessage('error', `Emulator aborted: ${reason}`);
                        reject(new Error(`Emulator aborted: ${reason}`));
                    }
                };

                // Import the Emscripten-generated JavaScript (use new filename to bypass cache)
                console.log('Worker: About to import kn10-ks.js...');
                importScripts('kn10-ks.js');
                console.log('Worker: Successfully imported kn10-ks.js');
                
            } catch (error) {
                console.error('Failed to load Emscripten script:', error);
                console.error('Error stack:', error.stack);
                this.sendMessage('error', `Failed to load emulator: ${error.message} | Stack: ${error.stack}`);
                reject(error);
            }
        });
    }

    startEmulator() {
        try {
            if (!this.Module || !this.Module.callMain) {
                throw new Error('Module not properly initialized');
            }

            this.isRunning = true;
            
            
            // Run the main function with config file argument
            // argv[0] = program name, argv[1] = config file
            setTimeout(() => {
                try {
                    // Run without config file argument - will use default "kn10-ks" file
                    this.Module.callMain(['kn10-ks']);
                } catch (e) {
                    console.error('callMain error:', e);
                    this.sendMessage('error', `Main execution failed: ${e.message}`);
                }
            }, 100);
            
        } catch (error) {
            this.sendMessage('error', `Failed to start emulator: ${error.message}`);
        }
    }

    setupWasmRingBuffers() {
        if (!this.wasmMemory || !this.ringBufferBase) {
            console.error('❌ No shared WASM memory or ring buffer base provided');
            return;
        }
        
        console.log('Worker: Setting up ring buffers in shared WASM memory');
        console.log('Worker: WASM memory buffer:', this.wasmMemory.buffer.byteLength, 'bytes');
        console.log('Worker: Ring buffer base offset:', this.ringBufferBase.toString(16));
        
        if (this.Module && this.Module._klh10_set_ring_buffer_offset) {
            // Tell WASM where the ring buffers are located in its own memory
            this.Module._klh10_set_ring_buffer_offset(this.ringBufferBase);
            
            // Create output ring buffer manager for JavaScript to write to
            // RingBufferManager calculates output offset internally from base
            this.outputRingBuffer = new RingBufferManager(this.wasmMemory.buffer, this.ringBufferBase);
            
            console.log('Worker: Ring buffers initialized at WASM memory offset:', this.ringBufferBase.toString(16));
        } else {
            console.error('Worker: klh10_set_ring_buffer_offset function not found');
        }
    }

    writeToWasmOutputRing(text) {
        if (!this.outputRingBuffer) {
            console.warn('Worker: Cannot write to output ring - not initialized');
            return;
        }
        
        // Write each character directly to WASM memory output ring buffer
        for (let i = 0; i < text.length; i++) {
            const success = this.outputRingBuffer.writeOutputChar(text[i]);
            if (!success) {
                console.warn('Worker: Output ring buffer full, character dropped');
                break;
            }
        }
    }
    
    

    sendMessage(type, data = null) {
        self.postMessage({ type, data });
    }
}

// Create worker instance
console.log('Creating EmulatorWorker instance...');
const worker = new EmulatorWorker();
console.log('EmulatorWorker instance created');

// Handle messages from main thread
self.onmessage = async (event) => {
    const { type, wasmMemory, ringBufferBase } = event.data;
    
    switch (type) {
        case 'start':
            console.log('Worker: Starting emulator with shared WASM memory...');
            if (wasmMemory) {
                worker.wasmMemory = wasmMemory;
                worker.ringBufferBase = ringBufferBase;
                console.log('Worker: Received shared WASM memory:', wasmMemory.buffer.byteLength, 'bytes');
                console.log('Worker: Ring buffer base:', ringBufferBase.toString(16));
            } else {
                console.error('Worker: No shared WASM memory provided!');
            }
            try {
                await worker.initialize();
                // After successful initialization, start the emulator
                worker.startEmulator();
            } catch (error) {
                worker.sendMessage('error', `Initialization failed: ${error.message}`);
            }
            break;
            
        case 'mode_change':
            worker.sendMessage('mode_change', data);
            break;
            
        default:
            worker.sendMessage('error', `Unknown message type: ${type}`);
    }
};