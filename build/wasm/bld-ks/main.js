// Main web interface for KLH10 PDP-10 Emulator
class KLH10WebInterface {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.worker = null;
        this.emulatorReady = false;
        this.inRuncmdMode = true;   // KLH10 starts in command mode by default
        
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
            if (this.worker && this.emulatorReady) {
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
                
                this.worker.postMessage({
                    type: 'input',
                    data: data
                });
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
                        break;
                        
                    case 'output':
                        this.terminal.write(data);
                        break;
                        
                    case 'mode_change':
                        this.inRuncmdMode = (data === 'command');
                        console.log(`🔄 Mode change: ${data.toUpperCase()} - ${this.inRuncmdMode ? 'enabling' : 'disabling'} input echo`);
                        break;
                        
                    case 'error':
                        this.updateStatus(`Error: ${data}`, 'error');
                        this.terminal.writeln(`\x1b[31mError: ${data}\x1b[0m`);
                        break;
                        
                    case 'exit':
                        this.updateStatus('Emulator exited', '');
                        this.terminal.writeln(`\x1b[33mEmulator exited with code: ${data}\x1b[0m`);
                        this.emulatorReady = false;
                        document.getElementById('startBtn').disabled = false;
                        document.getElementById('resetBtn').disabled = true;
                        document.getElementById('loadConfigBtn').disabled = true;
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
                this.terminal.writeln(`\x1b[31mWorker error: ${error.message || 'undefined'}\x1b[0m`);
                if (error.filename) {
                    this.terminal.writeln(`\x1b[31mFile: ${error.filename}:${error.lineno}:${error.colno}\x1b[0m`);
                }
            };

            // Start the emulator
            this.worker.postMessage({ type: 'start' });

        } catch (error) {
            this.updateStatus(`Failed to start: ${error.message}`, 'error');
            this.terminal.writeln(`\x1b[31mFailed to start emulator: ${error.message}\x1b[0m`);
            document.getElementById('startBtn').disabled = false;
        }
    }

    loadInstallationConfig() {
        if (!this.worker || !this.emulatorReady) {
            this.terminal.writeln('\x1b[31mEmulator not ready. Please start the emulator first.\x1b[0m');
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
                // Send command with newline
                this.worker.postMessage({
                    type: 'input',
                    data: command + '\r'
                });
                
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

    resetEmulator() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
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