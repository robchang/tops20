#!/usr/bin/env node
// build-rogue-exe.mjs — Boot TOPS-20, build Rogue, save EXE to tape, capture tape file
//
// This script automates the Rogue build process:
// 1. Boots TOPS-20 in headless Chromium
// 2. Restores Rogue source from tape
// 3. Compiles (PASCAL), assembles (MACRO), links (LINK)
// 4. Runs Rogue setup (creates score files)
// 5. Uses DUMPER to save the built files back to tape
// 6. Reads the tape file from the emulator's virtual filesystem
// 7. Saves it as the new rogue.tap (containing pre-built EXE)
//
// Prerequisites:
//   - npm install playwright (npx playwright install chromium)
//   - The dev server running on localhost:8080 (npm start)
//   - The original rogue.tap with source files must exist
//
// Usage: node tools/build-rogue-exe.mjs

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const outputPath = resolve('build/wasm/bld-kl/rogue.tap');

    console.log('=== Rogue EXE Build & Capture ===');
    console.log('Starting headless Chromium...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Forward useful console messages
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('tape') || text.includes('rogue') || text.includes('Mount') ||
            text.includes('Tape') || text.includes('DUMPER') || text.includes('output') ||
            text.includes('devmount') || text.includes('error') || text.includes('Error')) {
            console.log(`  [browser] ${text}`);
        }
    });

    // === Helper functions ===
    async function getTerminal() {
        return await page.evaluate(() => {
            const iface = window.klh10Interface;
            if (!iface || !iface.terminal) return '';
            const buf = iface.terminal.buffer.active;
            let text = '';
            for (let j = 0; j < buf.length; j++) {
                const line = buf.getLine(j);
                if (line) text += line.translateToString(true) + '\n';
            }
            return text;
        });
    }

    async function sendChars(str) {
        await page.evaluate((s) => {
            const iface = window.klh10Interface;
            if (!iface || !iface.inputRingBuffer) return;
            const rbm = iface.inputRingBuffer;
            for (let i = 0; i < s.length; i++) {
                rbm.writeInputChar(s[i]);
            }
        }, str);
    }

    async function sendCmd(cmd) { await sendChars(cmd + '\r'); }

    async function exec(cmd, waitMs = 5000) {
        const before = await getTerminal();
        console.log(`  >>> ${cmd}`);
        await sendCmd(cmd);
        await sleep(waitMs);
        const after = await getTerminal();
        const newOutput = after.length > before.length
            ? after.slice(before.length).split('\n').filter(l => l.trim()).join('\n')
            : '';
        if (newOutput) {
            // Show truncated output
            const lines = newOutput.split('\n');
            if (lines.length > 5) {
                console.log(`  ${lines.slice(0, 3).join('\n  ')}`);
                console.log(`  ... (${lines.length - 5} more lines)`);
                console.log(`  ${lines.slice(-2).join('\n  ')}`);
            } else {
                console.log(`  ${newOutput}`);
            }
        }
        return after;
    }

    async function getLastLines(n = 5) {
        const term = await getTerminal();
        return term.split('\n').filter(l => l.trim()).slice(-n).join('\n');
    }

    async function ctrlC() { await sendChars('\x03'); await sleep(3000); }

    async function waitForText(text, timeoutSec = 360, pollSec = 10) {
        for (let i = 0; i < timeoutSec / pollSec; i++) {
            await sleep(pollSec * 1000);
            const term = await getTerminal();
            const elapsed = (i + 1) * pollSec;
            if (elapsed % 30 === 0) console.log(`  ... ${elapsed}s`);
            if (term.includes(text)) return true;
        }
        return false;
    }

    // ===== Phase 1: Boot TOPS-20 =====
    console.log('\n[1/7] Booting TOPS-20...');
    await page.goto('http://localhost:8080', { timeout: 30000 });
    await sleep(2000);
    await page.click('#autoBootBtn', { timeout: 10000 });

    // Wait for boot to complete
    for (let i = 0; i < 36; i++) {
        await sleep(10000);
        const term = await getTerminal();
        const elapsed = (i + 1) * 10;
        if (elapsed % 30 === 0) console.log(`  ... ${elapsed}s [${term.length} chars]`);
        if (term.includes('FTS event') || term.includes('Batch-Stream 3  -- Startup Scheduled')) {
            console.log('  Boot complete!');
            break;
        }
    }
    await sleep(15000);
    await ctrlC();
    await sleep(5000);
    await ctrlC();
    await sleep(5000);

    // ===== Phase 2: Create directory & restore source =====
    console.log('\n[2/7] Restoring source files from tape...');
    await sendCmd('BUILD PS:<ROGUE>');
    await sleep(3000);
    for (let i = 0; i < 10; i++) { await sendChars('\r'); await sleep(500); }
    await sleep(5000);

    // Ensure we're at a clean EXEC prompt
    console.log('  Starting DUMPER...');
    await exec('DUMPER', 8000);
    await exec('TAPE MTA0:', 3000);
    await exec('RESTORE PS:<ROGUE>*.*', 30000);
    await exec('EXIT', 3000);
    await exec('CONNECT PS:<ROGUE>', 3000);

    // ===== Phase 3: Compile ROGUE.PAS =====
    console.log('\n[3/7] Compiling ROGUE.PAS (this takes ~60-90 seconds)...');
    await exec('PASCAL', 5000);
    await exec('ROGUE', 150000);  // Pascal compilation - allow up to 150 seconds
    await ctrlC();
    console.log('  Last lines after PASCAL:');
    console.log('  ' + await getLastLines(3));

    // ===== Phase 4: Assemble EXTERN.MAC =====
    console.log('\n[4/7] Assembling EXTERN.MAC...');
    await exec('MACRO', 5000);
    await exec('EXTERN=EXTERN', 90000);
    await ctrlC();
    console.log('  Last lines after MACRO:');
    console.log('  ' + await getLastLines(3));

    // ===== Phase 5: Link ROGUE.EXE =====
    console.log('\n[5/7] Linking ROGUE.EXE...');
    await exec('LINK', 5000);
    await exec('/NOSYMBOL', 3000);
    await exec('ROGUE,EXTERN,SYS:PASUNS/SEARCH', 30000);
    await exec('/SAVE ROGUE', 10000);
    await exec('/GO', 10000);
    await ctrlC();

    // Verify EXE was created
    const dirResult = await exec('DIR ROGUE.EXE', 5000);
    if (!dirResult.includes('ROGUE.EXE')) {
        console.error('ERROR: ROGUE.EXE was not created!');
        console.log(await getLastLines(20));
        await browser.close();
        process.exit(1);
    }
    console.log('  ROGUE.EXE created successfully!');

    // ===== Phase 6: Run Rogue setup =====
    console.log('\n[6/7] Running Rogue setup (creates score files)...');
    await exec('RUN ROGUE', 10000);
    await exec('ROGUE.CONFIGURATION', 10000);
    await sleep(5000);
    await sendCmd('');  // Empty line to finish setup
    await sleep(5000);
    await ctrlC();
    await sleep(3000);

    // ===== Phase 7: Save built files to tape & capture =====
    console.log('\n[7/7] Saving built files to tape...');

    // Use DUMPER to save the built files to MTA1: (writable output tape)
    await exec('DUMPER', 5000);
    await exec('TAPE MTA1:', 3000);
    await exec('SSNAME ROGUE-BUILT', 3000);
    // Save everything in the Rogue directory (EXE + config + score files + source)
    await exec('SAVE PS:<ROGUE>*.*', 60000);
    await exec('EXIT', 5000);

    console.log('  DUMPER save complete.');

    // ===== Phase 8: Extract tape from worker's MEMFS =====
    // The worker's event loop is blocked by callMain(), so postMessage won't work.
    // Use CDP (Chrome DevTools Protocol) to attach to the worker target,
    // pause execution via the debugger, evaluate JS to read the file, then resume.
    console.log('\n[8/8] Extracting tape from emulator...');

    let tapeData;

    // Use CDP page session + Target domain to reach the worker
    const cdp = await context.newCDPSession(page);

    // Find the worker target
    const { targetInfos } = await cdp.send('Target.getTargets');
    console.log('  CDP targets:', targetInfos.map(t => `${t.type}:${t.url.split('/').pop()}`));

    const workerTarget = targetInfos.find(t =>
        t.type === 'worker' && t.url.includes('emulator-worker'));

    if (!workerTarget) {
        console.error('ERROR: Worker target not found via CDP');
        await browser.close();
        process.exit(1);
    }

    // Attach to the worker target (flatten=false so sendMessageToTarget works)
    const { sessionId: workerSessionId } = await cdp.send('Target.attachToTarget', {
        targetId: workerTarget.targetId,
        flatten: false
    });
    console.log('  Attached to worker, session:', workerSessionId);

    // Helper: send a CDP command to the worker and wait for its response
    let nextMsgId = 1;
    const sendToWorker = (method, params = {}) => {
        return new Promise((resolve, reject) => {
            const msgId = nextMsgId++;
            const timeout = setTimeout(() => reject(new Error(`CDP ${method} timeout (30s)`)), 30000);

            const handler = (event) => {
                if (event.sessionId === workerSessionId) {
                    try {
                        const msg = JSON.parse(event.message);
                        if (msg.id === msgId) {
                            cdp.off('Target.receivedMessageFromTarget', handler);
                            clearTimeout(timeout);
                            if (msg.error) {
                                reject(new Error(`CDP ${method}: ${JSON.stringify(msg.error)}`));
                            } else {
                                resolve(msg.result || {});
                            }
                        }
                    } catch (e) { /* ignore parse errors from events */ }
                }
            };

            cdp.on('Target.receivedMessageFromTarget', handler);
            cdp.send('Target.sendMessageToTarget', {
                sessionId: workerSessionId,
                message: JSON.stringify({ id: msgId, method, params })
            }).catch(reject);
        });
    };

    try {
        // Enable debugger in the worker
        console.log('  Enabling debugger in worker...');
        await sendToWorker('Debugger.enable');

        // Pause execution (interrupts the WASM main loop)
        console.log('  Pausing worker execution...');
        await sendToWorker('Debugger.pause');
        await sleep(2000);  // Give V8 time to actually pause

        // Evaluate JS to read the file while paused
        console.log('  Reading output.tap from MEMFS...');
        const result = await sendToWorker('Runtime.evaluate', {
            expression: `
                (function() {
                    try {
                        var data = Module.FS.readFile('output.tap');
                        return JSON.stringify({ok: true, size: data.length, data: Array.from(data)});
                    } catch(e) {
                        return JSON.stringify({ok: false, error: e.message});
                    }
                })()
            `,
            returnByValue: true
        });

        // Resume execution
        console.log('  Resuming worker...');
        await sendToWorker('Debugger.resume');

        const parsed = JSON.parse(result.result.value);
        if (!parsed.ok) {
            throw new Error(`MEMFS read failed: ${parsed.error}`);
        }
        tapeData = parsed.data;
        console.log(`  Successfully read ${tapeData.length} bytes via CDP debugger`);
    } catch (err) {
        console.error('  CDP extraction failed:', err.message);
        // Try to resume in case we're paused
        try { await sendToWorker('Debugger.resume'); } catch (e) { /* ignore */ }
        await cdp.detach();
        await browser.close();
        process.exit(1);
    }

    await cdp.detach();

    console.log(`  Tape data: ${tapeData.length} bytes`);

    // Save the tape file
    const buffer = Buffer.from(tapeData);
    writeFileSync(outputPath, buffer);
    console.log(`  Saved to: ${outputPath}`);
    console.log(`  Tape size: ${(buffer.length / 1024).toFixed(1)} KB`);

    await browser.close();
    console.log('\n=== Done! rogue.tap now contains pre-built ROGUE.EXE ===');
    console.log('Users can now restore from tape without recompiling.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
