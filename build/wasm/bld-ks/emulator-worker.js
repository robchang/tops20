// Web Worker for KLH10 PDP-10 Emulator
class EmulatorWorker {
    constructor() {
        this.Module = null;
        this.isRunning = false;
        
        // Input handling for RUNCMD mode (line-based)
        this.inputBuffer = '';      // Accumulates characters until newline
        this.lineQueue = [];        // Complete lines ready for KLH10
        this.inputWaiting = false;  // True if KLH10 is waiting for input
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            try {
                // Configure Module before importing Emscripten script
                // Let Emscripten use its compiled memory settings
                self.Module = {
                    // Capture stdout/stderr and send to main thread
                    print: (text) => {
                        // Clean up any invalid UTF-8 characters
                        const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '');
                        
                        // If text already ends with newline, don't add another
                        // If it's a prompt (no trailing newline), add one only if it doesn't look like a prompt
                        if (cleanText.endsWith('\n') || cleanText.endsWith('# ') || cleanText.endsWith('> ') || cleanText.endsWith('>> ')) {
                            this.sendOutput(cleanText);
                        } else {
                            this.sendOutput(cleanText + '\n');
                        }
                    },
                    printErr: (text) => {
                        // Clean up any invalid UTF-8 characters  
                        const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '');
                        
                        // Same logic for stderr
                        if (cleanText.endsWith('\n') || cleanText.endsWith('# ') || cleanText.endsWith('> ') || cleanText.endsWith('>> ')) {
                            this.sendOutput(cleanText);
                        } else {
                            this.sendOutput(cleanText + '\n');
                        }
                    },
                    
                    // Handle module ready
                    onRuntimeInitialized: () => {
                        console.log('Emscripten runtime initialized');
                        this.Module = self.Module;
                        
                        // Create empty config file in virtual file system
                        // KLH10 processes each line as a command, so we want an empty file
                        const configContent = ``;
                        
                        try {
                            // Create config file with same name as program (KLH10 default behavior)
                            this.Module.FS.writeFile('/kn10-ks', configContent);
                            console.log('Created default config file in virtual FS');
                            
                            // List all files in the virtual filesystem for debugging
                            try {
                                var files = this.Module.FS.readdir('/');
                                console.log('Virtual FS files:', files);
                                
                                // Check if kn10-ks.ini exists
                                try {
                                    var iniContent = this.Module.FS.readFile('/kn10-ks.ini', { encoding: 'utf8' });
                                    console.log('Found kn10-ks.ini file, content:', iniContent);
                                } catch (e) {
                                    console.log('No kn10-ks.ini file found');
                                }
                                
                                // Check our created config file
                                try {
                                    var configCheck = this.Module.FS.readFile('/kn10-ks', { encoding: 'utf8' });
                                    console.log('Created kn10-ks file content:', JSON.stringify(configCheck));
                                } catch (e) {
                                    console.log('Could not read created kn10-ks file');
                                }
                            } catch (e) {
                                console.log('Could not list virtual FS files:', e);
                            }
                        } catch (err) {
                            console.warn('Could not create config file:', err);
                        }
                        
                        // Set up input handling hooks
                        this.setupInputHooks();
                        
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
                console.log('Loading Emscripten module...');
                importScripts('kn10-ks-FIXED.js');
                
            } catch (error) {
                console.error('Failed to load Emscripten script:', error);
                this.sendMessage('error', `Failed to load emulator: ${error.message}`);
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
            
            console.log('Starting emulator main...');
            
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

    handleInput(data) {
        if (!this.isRunning || !this.Module) {
            return;
        }

        try {
            console.log('📨 Input received:', JSON.stringify(data));
            // Accumulate input characters
            this.inputBuffer += data;
            
            // Process complete lines (when user presses Enter)
            while (this.inputBuffer.includes('\n') || this.inputBuffer.includes('\r')) {
                let newlineIndex = this.inputBuffer.indexOf('\n');
                let crIndex = this.inputBuffer.indexOf('\r');
                
                // Handle both \n and \r as line terminators
                if (newlineIndex === -1) newlineIndex = Infinity;
                if (crIndex === -1) crIndex = Infinity;
                
                const lineEnd = Math.min(newlineIndex, crIndex);
                if (lineEnd === Infinity) break;
                
                // Extract the line including the newline
                let line = this.inputBuffer.substring(0, lineEnd);
                this.inputBuffer = this.inputBuffer.substring(lineEnd + 1);
                
                // Always send lines, including empty ones (KLH10 needs them for prompt management)
                // Add newline for KLH10 compatibility
                line += '\n';
                this.lineQueue.push(line);
                console.log('Queued line:', JSON.stringify(line));
                
                // Directly add to WebAssembly input queue to bypass callback mechanism
                if (this.Module && typeof this.Module._klh10_add_input === 'function') {
                    // Allocate memory for the string
                    const len = line.length + 1;
                    const ptr = this.Module._malloc(len);
                    this.Module.stringToUTF8(line, ptr, len);
                    
                    // Call direct input addition function
                    this.Module._klh10_add_input(ptr);
                    this.Module._free(ptr);
                    console.log('📤 Added directly to WASM input system:', JSON.stringify(line));
                }
            }
            
        } catch (error) {
            this.sendMessage('error', `Input handling error: ${error.message}`);
        }
    }
    
    // Check if input is available (called by os_ttyintest)
    hasInput() {
        return this.lineQueue.length > 0;
    }
    
    // Get next line of input (called by os_ttycmline) 
    getLine(maxLength) {
        if (this.lineQueue.length === 0) {
            return null;
        }
        
        let line = this.lineQueue.shift();
        if (line.length > maxLength - 1) {
            line = line.substring(0, maxLength - 1);
        }
        
        console.log('Returning line:', JSON.stringify(line));
        
        // Also add to WebAssembly input queue for direct access
        if (this.Module && this.Module.KLH10_INPUT_STATE) {
            this.Module.KLH10_INPUT_STATE.inputQueue.push(line);
            console.log('📤 Added to WASM input queue:', JSON.stringify(line));
        }
        
        return line;
    }
    
    setupInputHooks() {
        // Set up callbacks for our custom input library
        const workerInstance = this;
        const moduleRef = this.Module; // Capture Module reference for callback scope
        
        // Create callback functions that the C code can call
        const hasInputCallback = this.Module.addFunction(() => {
            const result = workerInstance.hasInput();
            console.log('hasInput called, returning:', result);
            return result ? 1 : 0;
        }, 'i');
        
        const getLineCallback = this.Module.addFunction((maxSize) => {
            const line = workerInstance.getLine(maxSize);
            if (line) {
                // Allocate memory for the string and copy it
                const len = line.length + 1;
                const ptr = moduleRef._malloc(len);
                moduleRef.stringToUTF8(line, ptr, len);
                return ptr;
            }
            return 0; // NULL
        }, 'pi');
        
        // Initialize the input system with our callbacks
        if (this.Module._klh10_set_input_callbacks) {
            this.Module._klh10_set_input_callbacks(hasInputCallback, getLineCallback);
            console.log('Input callbacks registered successfully');
            console.log('hasInputCallback ptr:', hasInputCallback);
            console.log('getLineCallback ptr:', getLineCallback);
        } else {
            console.warn('klh10_set_input_callbacks function not found');
        }
    }

    sendMessage(type, data = null) {
        self.postMessage({ type, data });
    }

    sendOutput(text) {
        self.postMessage({ type: 'output', data: text });
    }
}

// Create worker instance
const worker = new EmulatorWorker();

// Handle messages from main thread
self.onmessage = async (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'start':
            try {
                await worker.initialize();
                // After successful initialization, start the emulator
                worker.startEmulator();
            } catch (error) {
                worker.sendMessage('error', `Initialization failed: ${error.message}`);
            }
            break;
            
        case 'input':
            worker.handleInput(data);
            break;
            
        case 'mode_change':
            worker.sendMessage('mode_change', data);
            break;
            
        default:
            worker.sendMessage('error', `Unknown message type: ${type}`);
    }
};