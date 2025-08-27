// Main web interface for KLH10 PDP-10 Emulator

// Ring Buffer Manager for shared memory communication (shared with worker)
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
}

class KLH10WebInterface {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.worker = null;
        this.emulatorReady = false;
        this.inRuncmdMode = true;   // KLH10 starts in command mode by default
        
        // Shared WebAssembly memory (proper approach)
        this.wasmMemory = null;
        this.inputRingBuffer = null;
        this.outputRingBuffer = null;
        
        this.initializeTerminal();
        this.setupEventListeners();
        this.updateStatus('Ready to start emulator', 'ready');
    }

    initializeTerminal() {
        // Create xterm.js terminal
        this.terminal = new Terminal({
            theme: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffffff',
                cursorAccent: '#000000',
                selection: '#44475a',
            },
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            cursorBlink: true,
            cols: 80,
            rows: 24,
            convertEol: true,  // Convert \n to \r\n for proper line breaks
            windowsMode: false // Keep Unix-style line endings in input
        });

        // Add fit addon for responsive terminal
        this.fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // Open terminal in DOM
        this.terminal.open(document.getElementById('terminal'));
        this.fitAddon.fit();

        // Handle terminal input
        this.terminal.onData((data) => {
            if (this.worker && this.emulatorReady && this.inputRingBuffer) {
                // Echo input in RUNCMD mode for visibility
                if (this.inRuncmdMode) {
                    // Handle special characters
                    if (data === '\r' || data === '\n') {
                        this.terminal.write('\r\n');
                    } else if (data === '\b' || data === '\x7f') {
                        // Backspace handling
                        this.terminal.write('\b \b');
                    } else if (data >= ' ' && data <= '~') {
                        // Printable characters
                        this.terminal.write(data);
                    }
                }
                
                // Write directly to WASM memory ring buffer - true zero-copy!
                
                
                for (let i = 0; i < data.length; i++) {
                    const char = data[i];
                    const success = this.inputRingBuffer.writeInputChar(char);
                    
                    
                    if (!success) {
                        console.warn('Main: Input ring buffer full, character dropped');
                        break;
                    }
                }
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
        });

        // Initial welcome message
        this.terminal.writeln('\x1b[36mKLH10 PDP-10 Emulator - WebAssembly Port\x1b[0m');
        this.terminal.writeln('Click "Start Emulator" to begin...');
        this.terminal.writeln('');
    }

    setupEventListeners() {
        const startBtn = document.getElementById('startBtn');
        const resetBtn = document.getElementById('resetBtn');
        const loadConfigBtn = document.getElementById('loadConfigBtn');

        startBtn.addEventListener('click', () => this.startEmulator());
        resetBtn.addEventListener('click', () => this.resetEmulator());
        loadConfigBtn.addEventListener('click', () => this.loadInstallationConfig());

        // Enable start button
        startBtn.disabled = false;
    }

    updateStatus(message, type = '') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = `status ${type}`;
    }

    async startEmulator() {
        try {
            this.updateStatus('Loading emulator...', 'loading');
            document.getElementById('startBtn').disabled = true;
            
            this.terminal.writeln('Starting KLH10 emulator...');
            this.terminal.writeln('');

            // Create shared WebAssembly memory (proper architecture)
            this.wasmMemory = new WebAssembly.Memory({
                initial: 256,    // 16MB initial 
                maximum: 512,    // 32MB maximum
                shared: true     // CRITICAL: Shared between main thread and worker
            });
            
            // Ring buffers will be at known offsets in WASM memory
            const RING_BUFFER_BASE = 0x10000;  // 64KB offset
            
            // Ring buffers will be at known offsets in WASM memory  
            // Create ONE ring buffer manager with the base offset
            // It will handle both input (at base) and output (at base + 4112) internally
            this.ringBufferManager = new RingBufferManager(this.wasmMemory.buffer, RING_BUFFER_BASE);
            
            // For compatibility, create aliases that point to the same manager
            this.inputRingBuffer = this.ringBufferManager;
            this.outputRingBuffer = this.ringBufferManager;
            
            console.log('Main: Created shared WASM memory:', this.wasmMemory.buffer.byteLength, 'bytes');
            console.log('Main: Input ring at offset:', this.ringBufferManager.inputOffset.toString(16));
            console.log('Main: Output ring at offset:', this.ringBufferManager.outputOffset.toString(16));

            // Create Web Worker for emulator with cache-busting
            const timestamp = Date.now();
            this.worker = new Worker(`emulator-worker.js?v=${timestamp}`);
            
            // Handle messages from worker
            this.worker.onmessage = (event) => {
                const { type, data } = event.data;
                
                switch (type) {
                    case 'ready':
                        this.emulatorReady = true;
                        this.updateStatus('Emulator ready', 'ready');
                        document.getElementById('resetBtn').disabled = false;
                        document.getElementById('loadConfigBtn').disabled = false;
                        
                        // Start polling output from shared ring buffer
                        this.startOutputPolling();
                        break;
                        
                    case 'mode_change':
                        this.inRuncmdMode = (data === 'command');
                        // Echo is automatically disabled in RUN mode, enabled in CMDRUN mode
                        break;
                        
                    case 'error':
                        this.updateStatus(`Error: ${data}`, 'error');
                        console.error('Emulator error:', data);
                        break;
                        
                    case 'exit':
                        this.updateStatus('Emulator exited', '');
                        this.terminal.writeln(`\x1b[33mEmulator exited with code: ${data}\x1b[0m`);
                        this.emulatorReady = false;
                        document.getElementById('startBtn').disabled = false;
                        document.getElementById('resetBtn').disabled = true;
                        document.getElementById('loadConfigBtn').disabled = true;
                        
                        // Stop output polling
                        if (this.outputPollInterval) {
                            clearInterval(this.outputPollInterval);
                            this.outputPollInterval = null;
                        }
                        break;
                }
            };

            this.worker.onerror = (error) => {
                console.error('Worker error event:', error);
                console.error('Worker error message:', error.message);
                console.error('Worker error filename:', error.filename);
                console.error('Worker error lineno:', error.lineno);
                console.error('Worker error colno:', error.colno);
                console.error('Worker error object:', error.error);
                
                this.updateStatus('Worker error', 'error');
                console.error('Worker error:', error.message || 'undefined');
                if (error.filename) {
                    console.error(`Worker error location: ${error.filename}:${error.lineno}:${error.colno}`);
                }
            };

            // Start the emulator with shared WASM memory
            this.worker.postMessage({ 
                type: 'start', 
                wasmMemory: this.wasmMemory,
                ringBufferBase: 0x10000  // Tell worker where ring buffers are located
            });

        } catch (error) {
            this.updateStatus(`Failed to start: ${error.message}`, 'error');
            console.error('Failed to start emulator:', error.message);
            document.getElementById('startBtn').disabled = false;
        }
    }

    loadInstallationConfig() {
        if (!this.worker || !this.emulatorReady || !this.inputRingBuffer) {
            console.warn('Load config attempted but emulator not ready');
            return;
        }

        this.terminal.writeln('\x1b[36mLoading TOPS-20 Installation Configuration...\x1b[0m');
        
        // Commands from inst-kst20.ini (excluding comments)
        const configCommands = [
            'devdef rh0  ub1   rh11\taddr=776700 br=6 vec=254',
            'devdef rh1  ub3   rh11\taddr=772440 br=6 vec=224',
            'devdef dsk0 rh0.0 rp\ttype=rp06 format=dbd9 path=T20-RP06.0-dbd9 iodly=0',
            'devdef mta0 rh1.0 tm03\tfmtr=tm03 type=tu45',
            'devmount mta0 bb-d867e-bm.tap fskip=2',
            'load smmtbt-k.sav'
        ];

        // Send each command with a delay to simulate typing
        let delay = 0;
        configCommands.forEach((command, index) => {
            setTimeout(() => {
                // Write command directly to WASM memory ring buffer
                const fullCommand = command + '\r';
                for (let i = 0; i < fullCommand.length; i++) {
                    this.inputRingBuffer.writeInputChar(fullCommand[i]);
                }
                
                // Show what we're sending if in command mode
                if (this.inRuncmdMode) {
                    this.terminal.write(command + '\r\n');
                }
                
                // After all commands, show completion message
                if (index === configCommands.length - 1) {
                    setTimeout(() => {
                        this.terminal.writeln('\x1b[32mConfiguration loaded! Type "go" to start the monitor.\x1b[0m');
                    }, 100);
                }
            }, delay);
            delay += 500; // 500ms delay between commands
        });
    }

    startOutputPolling() {
        // Poll output ring buffer at 60fps  
        this.outputPollInterval = setInterval(() => {
            this.drainOutputBuffer();
        }, 16); // ~60fps
    }

    drainOutputBuffer() {
        if (!this.outputRingBuffer) return;
        
        
        let output = '';
        let charCount = 0;
        while (this.outputRingBuffer.hasOutputData()) {
            const char = this.outputRingBuffer.readOutputChar();
            if (char) {
                output += char;
                charCount++;
            }
        }
        
        if (output.length > 0) {
            this.terminal.write(output);
        }
    }

    resetEmulator() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
        // Stop output polling
        if (this.outputPollInterval) {
            clearInterval(this.outputPollInterval);
            this.outputPollInterval = null;
        }
        
        // Clean up shared resources
        this.wasmMemory = null;
        this.inputRingBuffer = null;
        this.outputRingBuffer = null;
        this.emulatorReady = false;
        
        this.terminal.clear();
        this.terminal.writeln('\x1b[36mKLH10 PDP-10 Emulator - WebAssembly Port\x1b[0m');
        this.terminal.writeln('Click "Start Emulator" to begin...');
        this.terminal.writeln('');
        
        this.updateStatus('Ready to start emulator', 'ready');
        document.getElementById('startBtn').disabled = false;
        document.getElementById('resetBtn').disabled = true;
        document.getElementById('loadConfigBtn').disabled = true;
    }
}

// Initialize the interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new KLH10WebInterface();
});