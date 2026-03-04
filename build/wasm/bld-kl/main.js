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
        this.terminalEchoEnabled = true;  // Terminal echo enabled by default
        this.autoBootInProgress = false;  // True during one-click boot sequence
        this._readyResolve = null;        // Promise resolve for waitForReady()
        
        // Shared WebAssembly memory (proper approach)
        this.wasmMemory = null;
        this.inputRingBuffer = null;
        this.outputRingBuffer = null;
        
        this.initializeTerminal();
        this.setupEventListeners();
        this.updateStatus('Ready to start emulator', 'ready');
    }

    initializeTerminal() {
        // Create xterm.js terminal with green phosphor CRT theme
        this.terminal = new Terminal({
            theme: {
                background: '#000000',
                foreground: '#33ff33',
                cursor: '#33ff33',
                cursorAccent: '#000000',
                selection: '#005500',
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
        this.adjustTerminalToScreen();

        // Handle terminal input
        this.terminal.onData((data) => {
            if (this.autoBootInProgress) return; // Block input during auto-boot
            if (this.worker && this.emulatorReady && this.inputRingBuffer) {
                // Apply Ctrl sticky modifier from key toolbar
                if (this.ctrlActive && data.length === 1 && data >= '@' && data <= '~') {
                    data = String.fromCharCode(data.toUpperCase().charCodeAt(0) - 64);
                    this.ctrlActive = false;
                    const ctrlBtn = document.querySelector('.key-ctrl');
                    if (ctrlBtn) ctrlBtn.classList.remove('active');
                }

                // Echo input based on both mode and echo setting
                if (this.inRuncmdMode && this.terminalEchoEnabled) {
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

                this.sendInput(data);
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.adjustMobileLayout();
            this.adjustTerminalToScreen();
        });

        // Set initial mobile layout height
        this.adjustMobileLayout();

        // Handle mobile soft keyboard open/close
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                this.adjustMobileLayout();
                this.adjustTerminalToScreen();
            });
        }

        // Re-adjust terminal when VT100 frame image loads
        const vt100Img = document.querySelector('.vt100-image');
        if (vt100Img) {
            if (vt100Img.complete) {
                this.adjustTerminalToScreen();
            } else {
                vt100Img.addEventListener('load', () => this.adjustTerminalToScreen());
            }
        }

        // Initial welcome message
        this.terminal.writeln('\x1b[32mKLH10 PDP-10 Emulator - WebAssembly Port\x1b[0m');
        this.terminal.writeln('Click "Start Emulator" or "Boot TOPS-20" to begin...');
        this.terminal.writeln('');
        
        // Focus the terminal for immediate keyboard input
        this.terminal.focus();
    }

    // On mobile, set explicit container height from visualViewport (CSS dvh unreliable in iframes)
    isMobileLayout() {
        return window.innerWidth <= 600 || window.innerHeight <= 450;
    }

    adjustMobileLayout() {
        if (!this.isMobileLayout()) return;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.body.style.height = vh + 'px';
    }

    adjustTerminalToScreen() {
        const screenEl = document.querySelector('.vt100-screen');
        if (!screenEl) return;
        if (screenEl.clientWidth === 0) return;

        if (this.isMobileLayout()) {
            // Mobile: compute font size from available width and height.
            // Probe at a reference size to measure actual cell dimensions,
            // then scale to fit 80x24 in the available space.
            const probeSize = 14;
            this.terminal.options.fontSize = probeSize;
            this.fitAddon.fit();
            const colsAtProbe = this.terminal.cols;

            // Measure actual cell height from rendered probe
            const xtermScreen = document.querySelector('.xterm-screen');
            const probeRows = this.terminal.rows;
            const cellH = (xtermScreen && probeRows > 0)
                ? xtermScreen.clientHeight / probeRows
                : probeSize * 1.2;

            // Width constraint: fit 80 columns
            const fontByWidth = Math.floor(probeSize * colsAtProbe / 80);

            // Height constraint: fit 24 rows in available viewport height
            const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const toolbarH = document.getElementById('keyToolbar')?.offsetHeight || 0;
            const statusH = document.querySelector('.status')?.offsetHeight || 0;
            const controlsH = document.getElementById('simpleControls')?.offsetHeight || 0;
            const imgH = document.querySelector('.vt100-image')?.offsetHeight || 0;
            const screenPad = 10; // .vt100-screen padding + border
            const bodyPad = 12;   // body padding + margins
            const availH = vh - toolbarH - statusH - controlsH - imgH - screenPad - bodyPad;
            const cellHPerPx = cellH / probeSize; // cell height per 1px of font size
            const fontByHeight = availH > 0
                ? Math.floor(availH / (24 * cellHPerPx))
                : 32;

            const targetFont = Math.max(4, Math.min(fontByWidth, fontByHeight, 32));
            this.terminal.options.fontSize = targetFont;
            this.terminal.resize(80, 24);
            return;
        }

        // Desktop: binary search for the largest font where 80x24 fits in the container
        if (screenEl.clientHeight === 0) return;
        let lo = 4, hi = 32;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            this.terminal.options.fontSize = mid;
            this.fitAddon.fit();
            if (this.terminal.cols >= 80 && this.terminal.rows >= 24) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        this.terminal.options.fontSize = lo;
        this.fitAddon.fit();
        this.terminal.resize(80, 24);
    }

    // Send input data to the emulator via ring buffer
    sendInput(data) {
        if (!this.worker || !this.emulatorReady || !this.inputRingBuffer) return;
        for (let i = 0; i < data.length; i++) {
            const char = data[i];
            if (!this.inputRingBuffer.writeInputChar(char)) {
                console.warn('Main: Input ring buffer full, character dropped');
                break;
            }
        }
    }

    setupEventListeners() {
        // VT100 frame toggle
        const toggleLink = document.getElementById('toggleFrame');
        if (toggleLink) {
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                const frame = document.getElementById('vt100Frame');
                frame.classList.toggle('frameless');
                e.target.textContent = frame.classList.contains('frameless') ? 'Show Terminal Frame' : 'Hide Terminal Frame';
                setTimeout(() => this.adjustTerminalToScreen(), 50);
            });
        }

        // Key toolbar toggle (desktop)
        const keybarToggle = document.getElementById('toggleKeybar');
        if (keybarToggle) {
            keybarToggle.addEventListener('click', (e) => {
                e.preventDefault();
                const toolbar = document.getElementById('keyToolbar');
                const isVisible = toolbar.style.display === 'flex';
                toolbar.style.display = isVisible ? '' : 'flex';
                e.target.textContent = isVisible ? 'Show Key Toolbar' : 'Hide Key Toolbar';
            });
        }

        // Key toolbar buttons
        this.ctrlActive = false;
        const keyToolbar = document.getElementById('keyToolbar');
        if (keyToolbar) {
            const keyMap = {
                'esc': '\x1b',
                'tab': '\t',
                'up': '\x1b[A',
                'down': '\x1b[B',
                'left': '\x1b[D',
                'right': '\x1b[C',
                'ctrl-c': '\x03',
                'ctrl-z': '\x1a',
                'ctrl-d': '\x04',
            };

            keyToolbar.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                e.preventDefault();

                const key = btn.dataset.key;
                if (key === 'ctrl') {
                    // Toggle Ctrl sticky modifier
                    this.ctrlActive = !this.ctrlActive;
                    btn.classList.toggle('active', this.ctrlActive);
                } else if (keyMap[key]) {
                    this.sendInput(keyMap[key]);
                }

                // Refocus terminal so soft keyboard stays open
                this.terminal.focus();
            });
        }

        // Simple mode
        document.getElementById('autoBootBtn').addEventListener('click', () => this.autoBoot());
        document.getElementById('showAdvanced').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('simpleControls').style.display = 'none';
            document.getElementById('advancedControls').style.display = '';
        });
        document.getElementById('showSimple').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('advancedControls').style.display = 'none';
            document.getElementById('simpleControls').style.display = '';
        });

        // Advanced mode
        const startBtn = document.getElementById('startBtn');
        const resetBtn = document.getElementById('resetBtn');
        const loadConfigBtn = document.getElementById('loadConfigBtn');
        const bootTops20Btn = document.getElementById('bootTops20Btn');

        startBtn.addEventListener('click', () => this.startEmulator());
        resetBtn.addEventListener('click', () => this.resetEmulator());
        loadConfigBtn.addEventListener('click', () => this.loadInstallationConfig());
        bootTops20Btn.addEventListener('click', () => this.bootTops20());

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
            
            // console.log('Main: Created shared WASM memory:', this.wasmMemory.buffer.byteLength, 'bytes');
            // console.log('Main: Input ring at offset:', this.ringBufferManager.inputOffset.toString(16));
            // console.log('Main: Output ring at offset:', this.ringBufferManager.outputOffset.toString(16));

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
                        document.getElementById('bootTops20Btn').disabled = true; // Only enable after config loaded

                        // Start polling output from shared ring buffer
                        this.startOutputPolling();

                        // Resolve waitForReady() promise if auto-booting
                        if (this._readyResolve) {
                            this._readyResolve();
                            this._readyResolve = null;
                        }

                        // Focus terminal after emulator starts
                        this.terminal.focus();
                        break;
                        
                    case 'mode_change':
                        this.inRuncmdMode = (data === 'command');
                        // Echo is automatically disabled in RUN mode, enabled in CMDRUN mode
                        break;
                        
                    case 'loading_progress':
                        if (data.phase === 'start') {
                            this.updateStatus('Loading disk image (~476 MB)...', 'loading');
                        } else if (data.phase === 'downloading') {
                            const mb = (data.loaded / 1048576).toFixed(0);
                            const totalMb = (data.total / 1048576).toFixed(0);
                            const pct = Math.floor((data.loaded / data.total) * 100);
                            this.updateStatus(`Loading disk image... ${mb}/${totalMb} MB (${pct}%)`, 'loading');
                        } else if (data.phase === 'done') {
                            this.updateStatus('Disk image loaded, initializing emulator...', 'loading');
                        }
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
                        document.getElementById('bootTops20Btn').disabled = true;
                        
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

    async loadInstallationConfig() {
        if (!this.worker || !this.emulatorReady || !this.inputRingBuffer) {
            console.warn('Load config attempted but emulator not ready');
            return;
        }

        try {
            // Load the config commands from the text file
            const response = await fetch('tops20-config-commands.txt');
            if (!response.ok) {
                throw new Error('Could not load config commands file');
            }
            
            const commandsText = await response.text();
            const lines = commandsText.split('\n');
            
            // Process commands and filter out comments/empty lines
            const configCommands = [];
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    configCommands.push(trimmed);
                }
            }

            this.terminal.writeln('\x1b[36mLoading TOPS-20 Installation Configuration...\x1b[0m');
            this.terminal.writeln('\x1b[33mCommands loaded from: tops20-config-commands.txt\x1b[0m');

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
                    
                    // After all commands, show completion message and update button states
                    if (index === configCommands.length - 1) {
                        setTimeout(() => {
                            this.terminal.writeln('\x1b[32mConfiguration loaded! Ready to boot TOPS-20.\x1b[0m');
                            
                            // Disable Load Config button and enable BOOT TOPS-20 button
                            document.getElementById('loadConfigBtn').disabled = true;
                            document.getElementById('bootTops20Btn').disabled = false;
                            
                            // Focus terminal after config loads
                            this.terminal.focus();
                        }, 100);
                    }
                }, delay);
                delay += 500; // 500ms delay between commands
            });

        } catch (error) {
            this.terminal.writeln(`\x1b[31mError loading config commands: ${error.message}\x1b[0m`);
            console.error('Error loading config commands:', error);
        }
    }

    async bootTops20() {
        if (!this.worker || !this.emulatorReady || !this.inputRingBuffer) {
            console.warn('Boot TOPS-20 attempted but emulator not ready');
            return;
        }

        try {
            // Load the boot commands from the text file
            const response = await fetch('tops20-boot-commands.txt');
            if (!response.ok) {
                throw new Error('Could not load boot commands file');
            }
            
            const commandsText = await response.text();
            const lines = commandsText.split('\n');
            
            // Process commands and filter out comments/empty lines
            const bootCommands = [];
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    // Check if line starts with any { } command
                    if (trimmed.startsWith('{')) {
                        // Lines starting with { } commands - handle specially
                        if (trimmed === '{date-time}') {
                            // Generate current date/time in TOPS-20 format: DD-MMM-YYYY HHMM
                            const now = new Date();
                            const day = now.getDate().toString().padStart(2, '0');
                            const months = ['JAN','FEB','MAR','APR','MAY','JUN',
                                           'JUL','AUG','SEP','OCT','NOV','DEC'];
                            const month = months[now.getMonth()];
                            const year = now.getFullYear();
                            const hours = now.getHours().toString().padStart(2, '0');
                            const minutes = now.getMinutes().toString().padStart(2, '0');
                            const dateTime = `${day}-${month}-${year} ${hours}${minutes}`;
                            bootCommands.push({ command: dateTime, noCr: true }); // No CR for { } command lines
                        } else if (trimmed === '{ctrl-c}') {
                            // Send CTRL-C (ASCII 3)
                            bootCommands.push({ command: '\x03', noCr: true }); // No CR for { } command lines
                        } else if (trimmed.match(/^\{wait \d+\}$/)) {
                            // Extract wait duration from {wait #} format
                            const waitMatch = trimmed.match(/^\{wait (\d+)\}$/);
                            const waitSeconds = parseInt(waitMatch[1], 10);
                            bootCommands.push({ 
                                command: null, 
                                noCr: true, 
                                waitSeconds: waitSeconds 
                            });
                        } else if (trimmed === '{echo on}') {
                            // Turn on terminal echo
                            bootCommands.push({ 
                                command: null, 
                                noCr: true, 
                                echoControl: 'on' 
                            });
                        } else if (trimmed === '{echo off}') {
                            // Turn off terminal echo
                            bootCommands.push({ 
                                command: null, 
                                noCr: true, 
                                echoControl: 'off' 
                            });
                        } else if (trimmed === '{cr}') {
                            // Send carriage return
                            bootCommands.push({ 
                                command: '\r', 
                                noCr: true  // Already includes CR, don't add another
                            });
                        }
                        // Note: Lines starting with { } that we don't recognize are ignored
                    } else {
                        // Process {esc} and {nocr} inline within commands
                        let processedCommand = trimmed;
                        console.log(`[BOOT SCRIPT PARSE] Processing line: "${trimmed}"`);
                        processedCommand = processedCommand.replace(/\{esc\}/g, '\x1b'); // ESC character (ASCII 27)
                        
                        // Handle {nocr} - mark command to not add \r
                        const hasNoCr = processedCommand.includes('{nocr}');
                        processedCommand = processedCommand.replace(/\{nocr\}/g, ''); // Remove {nocr} markers
                        
                        console.log(`[BOOT SCRIPT PARSE] Final processed command: "${processedCommand}", noCr: ${hasNoCr}`);
                        
                        // Store command with nocr flag
                        bootCommands.push({
                            command: processedCommand,
                            noCr: hasNoCr
                        });
                    }
                }
            }

            this.terminal.writeln('\x1b[36mStarting TOPS-20 boot sequence...\x1b[0m');
            this.terminal.writeln('\x1b[33mCommands loaded from: tops20-boot-commands.txt\x1b[0m');
            
            // Disable the boot button immediately when starting
            document.getElementById('bootTops20Btn').disabled = true;
            
            // Execute commands sequentially with non-blocking delays
            this.executeCommandsSequentially(bootCommands, 0);
        } catch (error) {
            console.error('Error executing boot script:', error);
            this.terminal.writeln('\x1b[31mError executing boot script: ' + error.message + '\x1b[0m');
        }
    }

    executeCommandsSequentially(bootCommands, index, onComplete) {
        if (index >= bootCommands.length) {
            // All commands completed
            if (!this.autoBootInProgress) {
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[32mTOPS-20 running. Type HELP for more information.\x1b[0m');
            }
            this.terminal.focus();
            if (onComplete) onComplete();
            return;
        }

        const commandEntry = bootCommands[index];
        // Handle both string commands and object commands
        let command, noCr, waitSeconds, echoControl;
        if (typeof commandEntry === 'string') {
            command = commandEntry;
            noCr = false;
            waitSeconds = 0;
            echoControl = null;
        } else {
            command = commandEntry.command;
            noCr = commandEntry.noCr;
            waitSeconds = commandEntry.waitSeconds || 0;
            echoControl = commandEntry.echoControl || null;
        }

        // Handle echo control commands
        if (echoControl) {
            if (echoControl === 'on') {
                this.terminalEchoEnabled = true;
                this.terminal.writeln('\x1b[32mTerminal echo enabled\x1b[0m');
            } else if (echoControl === 'off') {
                this.terminalEchoEnabled = false;
                this.terminal.writeln('\x1b[33mTerminal echo disabled\x1b[0m');
            }
            // Continue with next command immediately
            this.executeCommandsSequentially(bootCommands, index + 1, onComplete);
            return;
        }

        // Handle wait commands
        if (waitSeconds > 0) {
            this.terminal.writeln(`\x1b[33mWaiting ${waitSeconds} seconds...\x1b[0m`);
            // Wait and then continue with next command - this allows event loop to run
            setTimeout(() => {
                this.executeCommandsSequentially(bootCommands, index + 1, onComplete);
            }, waitSeconds * 1000);
            return;
        }

        // Skip null commands
        if (command === null || command === undefined) {
            this.executeCommandsSequentially(bootCommands, index + 1, onComplete);
            return;
        }

        // Debug: Log what we're about to send
        console.log(`[BOOT SCRIPT] Sending command: "${command}" (length: ${command.length}), noCr: ${noCr}`);
        console.log(`[BOOT SCRIPT] Command char codes:`, Array.from(command).map(c => `${c}(${c.charCodeAt(0)})`).join(' '));

        // Write command directly to WASM memory ring buffer
        const fullCommand = noCr ? command : command + '\r';
        console.log(`[BOOT SCRIPT] Full command: "${fullCommand}" (length: ${fullCommand.length})`);
        for (let i = 0; i < fullCommand.length; i++) {
            this.inputRingBuffer.writeInputChar(fullCommand[i]);
        }

        // Small delay before next command to allow processing
        setTimeout(() => {
            this.executeCommandsSequentially(bootCommands, index + 1, onComplete);
        }, 500); // Small delay but allows event loop to run
    }


    startOutputPolling() {
        // Poll output ring buffer at 60fps  
        this.outputPollInterval = setInterval(() => {
            this.drainOutputBuffer();
        }, 16); // ~60fps
    }

    drainOutputBuffer() {
        if (!this.outputRingBuffer) return;
        
        // Check for flush request from WASM side
        const flushRequest = this.outputRingBuffer.view.getUint32(this.outputRingBuffer.controlOffset + 4, true);
        if (flushRequest) {
            // console.log('[JS_FLUSH] Detected flush request from WASM side');
        }
        
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
        
        // If there was a flush request, force terminal to flush and clear the request
        if (flushRequest) {
            // console.log('[JS_FLUSH] Processing flush request, output.length=' + output.length);
            // Force immediate terminal update - this ensures characters appear right away
            if (output.length > 0) {
                // Terminal write is already called above, just ensure it's processed
                setTimeout(() => {}, 0); // Allow browser to process the write immediately
            }
            // Clear the flush request
            this.outputRingBuffer.view.setUint32(this.outputRingBuffer.controlOffset + 4, 0, true);
            // console.log('[JS_FLUSH] Cleared flush request');
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
        this.autoBootInProgress = false;
        this._readyResolve = null;

        this.terminal.clear();
        this.terminal.writeln('\x1b[36mKLH10 PDP-10 Emulator - WebAssembly Port\x1b[0m');
        this.terminal.writeln('Click "Start Emulator" or "Boot TOPS-20" to begin...');
        this.terminal.writeln('');

        this.updateStatus('Ready to start emulator', 'ready');
        document.getElementById('startBtn').disabled = false;
        document.getElementById('resetBtn').disabled = true;
        document.getElementById('loadConfigBtn').disabled = true;
        document.getElementById('bootTops20Btn').disabled = true;
        document.getElementById('autoBootBtn').disabled = false;
        
        // Focus terminal after reset
        this.terminal.focus();
    }

    // --- Simple Mode (one-click boot) ---

    waitForReady() {
        if (this.emulatorReady) return Promise.resolve();
        return new Promise((resolve) => {
            this._readyResolve = resolve;
        });
    }

    loadInstallationConfigAsync() {
        return new Promise((resolve, reject) => {
            if (!this.worker || !this.emulatorReady || !this.inputRingBuffer) {
                reject(new Error('Emulator not ready'));
                return;
            }

            fetch('tops20-config-commands.txt')
                .then(response => {
                    if (!response.ok) throw new Error('Could not load config commands file');
                    return response.text();
                })
                .then(commandsText => {
                    const lines = commandsText.split('\n');
                    const configCommands = [];
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith(';')) {
                            configCommands.push(trimmed);
                        }
                    }

                    let delay = 0;
                    configCommands.forEach((command, index) => {
                        setTimeout(() => {
                            const fullCommand = command + '\r';
                            for (let i = 0; i < fullCommand.length; i++) {
                                this.inputRingBuffer.writeInputChar(fullCommand[i]);
                            }
                            if (this.inRuncmdMode) {
                                this.terminal.write(command + '\r\n');
                            }
                            if (index === configCommands.length - 1) {
                                setTimeout(() => {
                                    resolve();
                                }, 100);
                            }
                        }, delay);
                        delay += 500;
                    });
                })
                .catch(reject);
        });
    }

    bootTops20Async() {
        return new Promise((resolve, reject) => {
            if (!this.worker || !this.emulatorReady || !this.inputRingBuffer) {
                reject(new Error('Emulator not ready'));
                return;
            }

            fetch('tops20-boot-commands.txt')
                .then(response => {
                    if (!response.ok) throw new Error('Could not load boot commands file');
                    return response.text();
                })
                .then(commandsText => {
                    const lines = commandsText.split('\n');
                    const bootCommands = [];
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#')) {
                            if (trimmed.startsWith('{')) {
                                if (trimmed === '{date-time}') {
                                    const now = new Date();
                                    const day = now.getDate().toString().padStart(2, '0');
                                    const months = ['JAN','FEB','MAR','APR','MAY','JUN',
                                                   'JUL','AUG','SEP','OCT','NOV','DEC'];
                                    const month = months[now.getMonth()];
                                    const year = now.getFullYear();
                                    const hours = now.getHours().toString().padStart(2, '0');
                                    const minutes = now.getMinutes().toString().padStart(2, '0');
                                    const dateTime = `${day}-${month}-${year} ${hours}${minutes}`;
                                    bootCommands.push({ command: dateTime, noCr: true });
                                } else if (trimmed === '{ctrl-c}') {
                                    bootCommands.push({ command: '\x03', noCr: true });
                                } else if (trimmed.match(/^\{wait \d+\}$/)) {
                                    const waitMatch = trimmed.match(/^\{wait (\d+)\}$/);
                                    bootCommands.push({ command: null, noCr: true, waitSeconds: parseInt(waitMatch[1], 10) });
                                } else if (trimmed === '{echo on}') {
                                    bootCommands.push({ command: null, noCr: true, echoControl: 'on' });
                                } else if (trimmed === '{echo off}') {
                                    bootCommands.push({ command: null, noCr: true, echoControl: 'off' });
                                } else if (trimmed === '{cr}') {
                                    bootCommands.push({ command: '\r', noCr: true });
                                }
                            } else {
                                let processedCommand = trimmed;
                                processedCommand = processedCommand.replace(/\{esc\}/g, '\x1b');
                                const hasNoCr = processedCommand.includes('{nocr}');
                                processedCommand = processedCommand.replace(/\{nocr\}/g, '');
                                bootCommands.push({ command: processedCommand, noCr: hasNoCr });
                            }
                        }
                    }

                    this.executeCommandsSequentially(bootCommands, 0, resolve);
                })
                .catch(reject);
        });
    }

    async autoBoot() {
        this.autoBootInProgress = true;
        document.getElementById('autoBootBtn').disabled = true;
        const overlay = document.getElementById('bootOverlay');
        overlay.style.display = 'flex';

        try {
            // Step 1: Start emulator
            this.updateStatus('Initializing emulator...', 'loading');
            await this.startEmulator();

            // Step 2: Wait for worker to be ready (loads WASM + disk image)
            await this.waitForReady();

            // Step 3: Load config
            this.updateStatus('Configuring virtual hardware...', 'loading');
            await this.loadInstallationConfigAsync();

            // Step 4: Boot
            this.updateStatus('Booting TOPS-20...', 'loading');
            await this.bootTops20Async();

            // Done
            this.autoBootInProgress = false;
            overlay.style.display = 'none';
            this.updateStatus('TOPS-20 ready', 'ready');

            // On mobile, hide controls to reclaim space for terminal
            if (this.isMobileLayout()) {
                document.getElementById('simpleControls').style.display = 'none';
                this.adjustTerminalToScreen();
            }
            this.terminal.writeln('');
            this.terminal.writeln('\x1b[32mTOPS-20 ready. Type HELP for more information.\x1b[0m');
            this.terminal.focus();
            // Ensure focus by clicking the terminal element (some browsers need this)
            document.getElementById('terminal').click();
            this.terminal.focus();
        } catch (error) {
            this.autoBootInProgress = false;
            overlay.style.display = 'none';
            this.updateStatus(`Boot failed: ${error.message}`, 'error');
            document.getElementById('autoBootBtn').disabled = false;
            console.error('Auto-boot failed:', error);
        }
    }
}

// Check browser compatibility before initializing
function checkBrowserCompatibility() {
    const missing = [];
    if (typeof WebAssembly === 'undefined') missing.push('WebAssembly');
    if (typeof SharedArrayBuffer === 'undefined') missing.push('SharedArrayBuffer');
    if (typeof Worker === 'undefined') missing.push('Web Workers');
    return missing;
}

// Initialize the interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const missing = checkBrowserCompatibility();
    if (missing.length > 0) {
        const status = document.getElementById('status');
        status.textContent = 'Browser not compatible';
        status.className = 'status error';
        const controls = document.getElementById('simpleControls');
        controls.innerHTML = `
            <div style="max-width: 500px; margin: 0 auto; text-align: left; background: #2a1a1a; border: 1px solid #e57373; border-radius: 8px; padding: 20px;">
                <p style="color: #e57373; margin-top: 0;"><strong>Missing browser features:</strong> ${missing.join(', ')}</p>
                <p style="color: #ccc; margin-bottom: 8px;">This emulator requires a modern browser with SharedArrayBuffer support. Compatible browsers:</p>
                <ul style="color: #ccc; margin: 0; padding-left: 20px;">
                    <li>Chrome / Edge 91+</li>
                    <li>Firefox 79+</li>
                    <li>Safari 15.2+</li>
                </ul>
            </div>`;
        return;
    }
    window.__klh10 = new KLH10WebInterface();
});