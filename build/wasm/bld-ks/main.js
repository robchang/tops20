// Main web interface for KLH10 PDP-10 Emulator
class KLH10WebInterface {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.worker = null;
        this.emulatorReady = false;
        
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

        startBtn.addEventListener('click', () => this.startEmulator());
        resetBtn.addEventListener('click', () => this.resetEmulator());

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

            // Create Web Worker for emulator
            this.worker = new Worker('emulator-worker.js');
            
            // Handle messages from worker
            this.worker.onmessage = (event) => {
                const { type, data } = event.data;
                
                switch (type) {
                    case 'ready':
                        this.emulatorReady = true;
                        this.updateStatus('Emulator ready', 'ready');
                        document.getElementById('resetBtn').disabled = false;
                        break;
                        
                    case 'output':
                        this.terminal.write(data);
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
                        break;
                }
            };

            this.worker.onerror = (error) => {
                this.updateStatus('Worker error', 'error');
                this.terminal.writeln(`\x1b[31mWorker error: ${error.message}\x1b[0m`);
            };

            // Start the emulator
            this.worker.postMessage({ type: 'start' });

        } catch (error) {
            this.updateStatus(`Failed to start: ${error.message}`, 'error');
            this.terminal.writeln(`\x1b[31mFailed to start emulator: ${error.message}\x1b[0m`);
            document.getElementById('startBtn').disabled = false;
        }
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
    }
}

// Initialize the interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new KLH10WebInterface();
});