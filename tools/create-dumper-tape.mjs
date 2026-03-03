#!/usr/bin/env node
// create-dumper-tape.mjs — Create a TOPS-20 DUMPER format tape (.tap file)
//
// Creates a SIMH .tap container with a DUMPER V6 saveset.
// Based on format spec from contrib/read20/dump.h and KLH10 wfio.c
//
// Usage: node tools/create-dumper-tape.mjs [output.tap] [file1:dest1] [file2:dest2] ...

import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';

// ============================================================
// Constants
// ============================================================
const RECORD_WORDS = 518;       // 6-word header + 512 data words
const HEADER_WORDS = 6;
const DATA_WORDS = 512;
const BYTES_PER_WORD = 5;
const RECORD_BYTES = RECORD_WORDS * BYTES_PER_WORD; // 2590

// Record types (stored NEGATED in the header)
const RECTYP_DATA   = 0;
const RECTYP_TPHD   = 1;  // Saveset header
const RECTYP_FLHD   = 2;  // File header
const RECTYP_FLTR   = 3;  // File trailer
const RECTYP_TPTR   = 4;  // Tape trailer
const RECTYP_FILL   = 7;  // Filler

// DUMPER format version
const DUMPER_FMT_V6 = 6;

// FL.HIS flags (must always be set in word 1)
const FL_HIS = 0o170000000000n;
// FL.NCK - no checksum (V6 flag, bit 0 = MSB)
const FL_NCK = 0o400000000000n;

// ============================================================
// 36-bit word helpers (using BigInt)
// ============================================================

// Make a PDP-10 word from left and right halves
function makeWord(lh, rh) {
    return ((BigInt(lh) & 0o777777n) << 18n) | (BigInt(rh) & 0o777777n);
}

// Negate a 36-bit value (two's complement in 36 bits)
function negate36(val) {
    return ((~val) + 1n) & 0o777777777777n;
}

// Write a 36-bit word in core-dump format (5 bytes)
// Format from wfio.c:
//   byte[0] = (LH >> 10) & 0xFF     bits 0-7
//   byte[1] = (LH >>  2) & 0xFF     bits 8-15
//   byte[2] = ((LH & 03) << 6) | ((RH >> 12) & 077)  bits 16-23
//   byte[3] = (RH >>  4) & 0xFF     bits 24-31
//   byte[4] = RH & 0x0F             bits 32-35 (low nibble)
function wordToBytes(w) {
    const lh = Number((w >> 18n) & 0o777777n);
    const rh = Number(w & 0o777777n);
    return [
        (lh >> 10) & 0xFF,
        (lh >> 2) & 0xFF,
        ((lh & 0x03) << 6) | ((rh >> 12) & 0x3F),
        (rh >> 4) & 0xFF,
        rh & 0x0F
    ];
}

// Read a 36-bit word from core-dump bytes
function bytesToWord(buf, offset) {
    const b0 = buf[offset], b1 = buf[offset+1], b2 = buf[offset+2];
    const b3 = buf[offset+3], b4 = buf[offset+4];
    const lh = (b0 << 10) | (b1 << 2) | (b2 >> 6);
    const rh = ((b2 & 0x3F) << 12) | (b3 << 4) | (b4 & 0x0F);
    return (BigInt(lh) << 18n) | BigInt(rh);
}

// Pack a string into 7-bit ASCII ASCIZ format (5 chars per 36-bit word)
// Returns array of BigInt words, null-terminated
function stringToAsciz(str) {
    const words = [];
    let w = 0n;
    let charInWord = 0;

    for (let i = 0; i < str.length; i++) {
        const ch = BigInt(str.charCodeAt(i) & 0x7F);
        // Shifts: char 0 at bit 29, char 1 at 22, char 2 at 15, char 3 at 8, char 4 at 1
        const shift = BigInt((4 - charInWord) * 7 + 1);
        w |= (ch << shift);
        charInWord++;
        if (charInWord >= 5) {
            words.push(w);
            w = 0n;
            charInWord = 0;
        }
    }
    // Add null terminator
    if (charInWord > 0) {
        // Remaining chars in word already have zeros for remaining positions
        words.push(w);
    }
    // Ensure at least one null word for termination
    if (words.length === 0 || charInWord === 0) {
        // If str length is exact multiple of 5, we need another word with null
        if (str.length > 0 && str.length % 5 === 0) {
            words.push(0n);
        }
    }
    return words;
}

// Convert a JavaScript string to PDP-10 words with 7-bit bytes (for file content)
// Returns array of BigInt words. Converts LF to CR+LF for TOPS-20.
function textToWords(text) {
    // Convert Unix line endings to TOPS-20 CR+LF
    const t20text = text.replace(/\r?\n/g, '\r\n');
    const words = [];
    let w = 0n;
    let charInWord = 0;

    for (let i = 0; i < t20text.length; i++) {
        const ch = BigInt(t20text.charCodeAt(i) & 0x7F);
        const shift = BigInt((4 - charInWord) * 7 + 1);
        w |= (ch << shift);
        charInWord++;
        if (charInWord >= 5) {
            words.push(w);
            w = 0n;
            charInWord = 0;
        }
    }
    // Push final partial word (with trailing nulls)
    if (charInWord > 0) {
        words.push(w);
    }
    return words;
}

// ============================================================
// DUMPER record builder
// ============================================================

class DumperTapeBuilder {
    constructor(savesetName) {
        this.savesetName = savesetName;
        this.tapeNumber = 1;
        this.seqNum = 0;
        this.fileNum = 0;
        this.records = [];  // Array of 518-word records (each is BigInt[518])
    }

    // Create a 518-word record with header
    createRecord(type, pageNum = 0) {
        this.seqNum++;
        const words = new Array(RECORD_WORDS).fill(0n);

        // Word 0: checksum (computed later)
        // Word 1: flags (FL.HIS always set, FL.NCK to skip checksum)
        words[1] = FL_HIS | FL_NCK;
        // Word 2: tape number
        words[2] = BigInt(this.tapeNumber);
        // Word 3: F1F2 + file number + page number
        //   F1=0, F2=1 (new format) => bit 1 set => 0o200000000000
        //   File number in bits 2-17 (16 bits)
        //   Page number in bits 18-35
        const f1f2 = 0o200000n;  // F2=1 (new format)
        const fileField = BigInt(this.fileNum) & 0o177777n;
        const pageField = BigInt(pageNum) & 0o777777n;
        words[3] = (f1f2 << 18n) | (fileField << 18n) | pageField;
        // Word 4: record type (NEGATED)
        words[4] = negate36(BigInt(type));
        // Word 5: sequence number
        words[5] = BigInt(this.seqNum);

        return words;
    }

    // Compute and set checksum (XOR of all 518 words, result makes XOR = 0)
    setChecksum(words) {
        let cksum = 0n;
        for (let i = 1; i < RECORD_WORDS; i++) {
            cksum ^= words[i];
        }
        words[0] = cksum;
    }

    // Add saveset header (TPHD, type 1)
    addSavesetHeader() {
        const rec = this.createRecord(RECTYP_TPHD);

        // Data section (starting at word 6):
        // Word 6: format version
        rec[6] = BigInt(DUMPER_FMT_V6);
        // Word 7: pointer to saveset name (20 for V6, meaning word 6+20=26 in the record)
        rec[7] = 20n;
        // Word 8: TAD (date) - use a reasonable date (2024-01-01)
        // TAD is internal TOPS-20 format, we'll use 0 for simplicity
        rec[8] = 0n;

        // Saveset name at word 26 (= 6 + 20)
        const nameWords = stringToAsciz(this.savesetName);
        for (let i = 0; i < nameWords.length && (26 + i) < RECORD_WORDS; i++) {
            rec[26] = nameWords[i];
            if (i > 0) rec[26 + i] = nameWords[i];
        }
        // Fix: write all name words
        for (let i = 0; i < nameWords.length && (26 + i) < RECORD_WORDS; i++) {
            rec[26 + i] = nameWords[i];
        }

        this.setChecksum(rec);
        this.records.push(rec);
    }

    // Add file header (FLHD, type 2)
    addFileHeader(filename, byteSize, byteCount, pageCount) {
        this.fileNum++;
        const rec = this.createRecord(RECTYP_FLHD);

        // Data section: words 6-205 = ASCIZ filename, words 206-517 = FDB
        // Filename at word 6 (WdoffFLName = 6)
        const nameWords = stringToAsciz(filename);
        for (let i = 0; i < nameWords.length && (6 + i) < 200; i++) {
            rec[6 + i] = nameWords[i];
        }

        // FDB at word 134 (octal) = 92 decimal... wait, WdoffFDB = 134
        // 134 is OCTAL = 92 decimal? No, looking at dump.h:
        // #define WdoffFDB 134  — but this is C, so it's decimal 134
        // Actually looking more carefully: it says WdoffFLName = 6 and WdoffFDB = 134
        // These are word offsets from the start of the record
        // But wait, word 6 is the start of data... FDB at word 134 means
        // the FDB starts at word 134 from the record start, which is word 128 from data start
        // That leaves words 6-133 for the filename (128 words = 640 chars max)

        // FDB structure (offsets relative to FDB start at word 134):
        // +0: .FBHDR - header/length word
        // +1: .FBCTL - control bits (archived, invisible, offline)
        // +4: .FBPRT - protection (RH)
        // +9 (011 octal): .FBBSZ - byte size (bits 6-11) + page count (RH, 18 bits)
        // +10 (012 octal): .FBSIZ - byte count
        // +12 (014 octal): .FBWRT - last write date (TAD)
        // +13 (015 octal): .FBREF - last read date (TAD)

        const fdbOff = 134;

        // .FBHDR (word 0 of FDB): length of FDB
        rec[fdbOff + 0] = 37n;  // 37 words (V6 FDB size)

        // .FBCTL (word 1): control bits — leave as 0 (normal file)
        rec[fdbOff + 1] = 0n;

        // .FBPRT (word 4): protection in right half
        // 777752 is standard protection (owner: full, group: read+execute)
        rec[fdbOff + 4] = makeWord(0, 0o777752);

        // .FBBSZ (word 9, octal 011): byte size in bits 6-11, page count in RH
        const bszField = (BigInt(byteSize) & 0o77n) << 24n;  // bits 6-11 of word
        const pgcField = BigInt(pageCount) & 0o777777n;
        rec[fdbOff + 9] = bszField | pgcField;

        // .FBSIZ (word 10, octal 012): byte count (full 36-bit word)
        rec[fdbOff + 10] = BigInt(byteCount) & 0o777777777777n;

        this.setChecksum(rec);
        this.records.push(rec);
    }

    // Add data record (DATA, type 0)
    addDataRecord(pageNum, dataWords) {
        const rec = this.createRecord(RECTYP_DATA, pageNum);

        // Copy data words into record (up to 512 words)
        for (let i = 0; i < dataWords.length && i < DATA_WORDS; i++) {
            rec[HEADER_WORDS + i] = dataWords[i];
        }

        this.setChecksum(rec);
        this.records.push(rec);
    }

    // Add file trailer (FLTR, type 3)
    addFileTrailer(byteSize, byteCount, pageCount) {
        const rec = this.createRecord(RECTYP_FLTR);

        // FDB in data section (from word 6)
        // Simpler FDB for trailer
        rec[6 + 0] = 37n;
        rec[6 + 4] = makeWord(0, 0o777752);
        const bszField = (BigInt(byteSize) & 0o77n) << 24n;
        rec[6 + 9] = bszField | (BigInt(pageCount) & 0o777777n);
        rec[6 + 10] = BigInt(byteCount) & 0o777777777777n;

        this.setChecksum(rec);
        this.records.push(rec);
    }

    // Add tape trailer (TPTR, type 4)
    addTapeTrailer() {
        const rec = this.createRecord(RECTYP_TPTR);
        this.setChecksum(rec);
        this.records.push(rec);
    }

    // Add a complete file to the saveset
    addFile(tops20Name, content, isBinary = false) {
        const byteSize = isBinary ? 36 : 7;

        // Convert content to PDP-10 words
        let dataWords;
        if (isBinary) {
            // Binary: content should already be an array of BigInt words
            dataWords = content;
        } else {
            // Text: convert string to 7-bit packed words
            dataWords = textToWords(content);
        }

        // Calculate sizes
        const wordsPerPage = 512;
        const pageCount = Math.ceil(dataWords.length / wordsPerPage) || 1;

        // For text files, byte count is the number of 7-bit characters
        // (after CR+LF conversion)
        let byteCount;
        if (isBinary) {
            byteCount = dataWords.length;  // word count for 36-bit files
        } else {
            const t20text = content.replace(/\r?\n/g, '\r\n');
            byteCount = t20text.length;
        }

        // File header
        this.addFileHeader(tops20Name, byteSize, byteCount, pageCount);

        // Data pages
        for (let page = 0; page < pageCount; page++) {
            const start = page * wordsPerPage;
            const pageWords = dataWords.slice(start, start + wordsPerPage);
            this.addDataRecord(page, pageWords);
        }

        // File trailer
        this.addFileTrailer(byteSize, byteCount, pageCount);

        console.log(`  Added: ${tops20Name} (${byteCount} bytes, ${pageCount} pages, ${dataWords.length} words)`);
    }

    // Build the complete tape as a Buffer (SIMH .tap format)
    build() {
        const chunks = [];

        // Helper to write a SIMH tape record
        function writeTapeRecord(recordBytes) {
            const len = recordBytes.length;
            const header = Buffer.alloc(4);
            header.writeUInt32LE(len);
            chunks.push(header);
            chunks.push(recordBytes);
            // Pad to even length if needed (SIMH requirement)
            if (len % 2 !== 0) {
                chunks.push(Buffer.from([0]));
            }
            const trailer = Buffer.alloc(4);
            trailer.writeUInt32LE(len);
            chunks.push(trailer);
        }

        // Helper to write a tape mark
        function writeTapeMark() {
            const mark = Buffer.alloc(4);
            mark.writeUInt32LE(0);
            chunks.push(mark);
        }

        // Convert each 518-word record to bytes and write as tape record
        for (const record of this.records) {
            const bytes = Buffer.alloc(RECORD_BYTES);
            for (let w = 0; w < RECORD_WORDS; w++) {
                const wb = wordToBytes(record[w]);
                for (let b = 0; b < 5; b++) {
                    bytes[w * 5 + b] = wb[b];
                }
            }
            writeTapeRecord(bytes);
        }

        // Double tape mark = end of tape
        writeTapeMark();
        writeTapeMark();

        return Buffer.concat(chunks);
    }
}

// ============================================================
// Main
// ============================================================

function usage() {
    console.log(`Usage: node create-dumper-tape.mjs <output.tap> <localfile:TOPS20NAME> ...

Creates a TOPS-20 DUMPER format tape image.

Arguments:
  output.tap           Output tape file path
  localfile:TOPS20NAME  Local file path mapped to TOPS-20 filename
                        e.g., rogue.pas:PS:<ROGUE>ROGUE.PAS.1

Example:
  node tools/create-dumper-tape.mjs rogue.tap \\
    rogue/rogue.pas:"PS:<ROGUE>ROGUE.PAS.1" \\
    rogue/extern.mac:"PS:<ROGUE>EXTERN.MAC.1"
`);
}

function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        usage();
        process.exit(1);
    }

    const outputFile = args[0];
    const fileSpecs = args.slice(1);

    console.log(`Creating DUMPER tape: ${outputFile}`);
    console.log(`Saveset: "Rogue Game Sources"`);
    console.log();

    const builder = new DumperTapeBuilder('Rogue Game Sources');

    // Add saveset header
    builder.addSavesetHeader();

    // Add each file
    for (const spec of fileSpecs) {
        const colonIdx = spec.indexOf(':');
        if (colonIdx < 0) {
            console.error(`Error: File spec must be localfile:TOPS20NAME, got: ${spec}`);
            process.exit(1);
        }
        const localPath = spec.substring(0, colonIdx);
        const tops20Name = spec.substring(colonIdx + 1);

        try {
            const content = readFileSync(localPath, 'utf-8');
            builder.addFile(tops20Name, content);
        } catch (err) {
            console.error(`Error reading ${localPath}: ${err.message}`);
            process.exit(1);
        }
    }

    // Add tape trailer
    builder.addTapeTrailer();

    // Build and write
    const tape = builder.build();
    writeFileSync(outputFile, tape);
    console.log(`\nWrote ${tape.length} bytes to ${outputFile}`);
    console.log(`${builder.records.length} DUMPER records, ${builder.seqNum} sequence numbers`);

    // Verify by reading back
    console.log('\n=== Verification ===');
    let offset = 0;
    let recNum = 0;
    while (offset < tape.length - 4) {
        const len = tape.readUInt32LE(offset);
        offset += 4;
        if (len === 0) {
            console.log(`  Tape mark`);
            offset += 0; // tape marks are just the 4-byte zero
            continue;
        }
        const data = tape.subarray(offset, offset + len);
        const w4 = bytesToWord(data, 4 * 5);
        const w5 = bytesToWord(data, 5 * 5);
        const recType = Number(negate36(w4));
        const recTypeNames = ['DATA', 'SAVEST', 'FILEST', 'FILEEN', 'TAPEEN', 'DIRECT', 'CONTST', 'FILL'];
        const typeName = recTypeNames[recType] || `TYPE${recType}`;

        if (recType !== 0) {
            // For non-data records, show more detail
            if (recType === 2) {
                // File header - extract filename
                const nameWords = [];
                for (let i = 6; i < 134; i++) {
                    const w = bytesToWord(data, i * 5);
                    nameWords.push(w);
                    if (w === 0n) break;
                }
                let name = '';
                for (const w of nameWords) {
                    for (let j = 0; j < 5; j++) {
                        const shift = BigInt((4 - j) * 7 + 1);
                        const ch = Number((w >> shift) & 0x7Fn);
                        if (ch === 0) { name += '\0'; break; }
                        if (ch >= 0x20 && ch <= 0x7E) name += String.fromCharCode(ch);
                    }
                    if (name.includes('\0')) break;
                }
                name = name.replace(/\0/g, '');
                console.log(`  Record ${recNum}: ${typeName} seq=${Number(w5)} file="${name}"`);
            } else {
                console.log(`  Record ${recNum}: ${typeName} seq=${Number(w5)}`);
            }
        }
        offset += len;
        if (len % 2 !== 0) offset++; // skip padding
        offset += 4; // trailing length
        recNum++;
    }
}

main();
