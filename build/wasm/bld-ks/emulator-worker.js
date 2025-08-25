// Web Worker for KLH10 PDP-10 Emulator
class EmulatorWorker {
    constructor() {
        this.Module = null;
        this.inputBuffer = [];
        this.isRunning = false;
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
                        const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '?');
                        this.sendOutput(cleanText + '\n');
                    },
                    printErr: (text) => {
                        // Clean up any invalid UTF-8 characters  
                        const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '?');
                        this.sendOutput(cleanText + '\n');
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

                // Import the Emscripten-generated JavaScript
                console.log('Loading Emscripten module...');
                importScripts('./kn10-ks');
                
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
            // Convert input data to the emulator
            // For now, we'll buffer input and handle it when the emulator requests it
            this.inputBuffer.push(...data.split(''));
            
            // If emulator is waiting for input, provide it
            // This is a simplified approach - real implementation would need
            // proper stdin handling through Emscripten's FS system
            
        } catch (error) {
            this.sendMessage('error', `Input handling error: ${error.message}`);
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
            
        default:
            worker.sendMessage('error', `Unknown message type: ${type}`);
    }
};