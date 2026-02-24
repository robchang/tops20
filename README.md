# KLH10 — Run TOPS-20 in Your Browser

A PDP-10 emulator compiled to WebAssembly that boots DEC TOPS-20 V7.0 with an interactive terminal in your browser.

This is a WebAssembly port of Kenneth L. Harrenstien's [KLH10](https://github.com/PDP-10/klh10) PDP-10 emulator, running Mark Crispin's [Panda TOPS-20](https://panda.trailing-edge.com/) distribution — an enhanced version of DEC's TOPS-20 operating system with bugfixes, Stanford extensions, and bundled software.

## Quick Start

**Prerequisites:** Node.js, curl, bunzip2, tar

```bash
git clone https://github.com/robchang/tops20.git
cd tops20
./download-images.sh          # Downloads ~320 MB, extracts to ~500 MB
cd build/wasm/bld-kl
node serve.js                 # Starts HTTP server on port 8080
```

Open http://localhost:8080 in your browser, then:

1. Click **Start Emulator** — initializes the WebAssembly module
2. Click **Load TOPS-20 Config** — configures virtual hardware (RP07 disk, DTE)
3. Click **BOOT TOPS-20** — boots the operating system
4. Login: **operator** / **dec-20**

## What Is This?

The [PDP-10](https://en.wikipedia.org/wiki/PDP-10) was a mainframe computer built by Digital Equipment Corporation from 1966 to 1988. It was the machine behind MIT's AI Lab, the original ARPANET nodes, and Stanford's computing infrastructure. [TOPS-20](https://en.wikipedia.org/wiki/TOPS-20) was DEC's flagship operating system for the PDP-10, known for its command completion, sophisticated file system, and user-friendly design — features that influenced Unix and modern operating systems.

**KLH10** is a cycle-accurate PDP-10 emulator written in C by Kenneth L. Harrenstien. It emulates the physical hardware (CPU, disks, tapes, network) and runs unmodified TOPS-20 binaries.

This project ports KLH10 to run in your browser via WebAssembly (Emscripten), with an xterm.js terminal providing VT100 console access.

## Building from Source

### Using Dev Container (Recommended)

Open this repository in VS Code with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension. The `.devcontainer/` configuration includes Emscripten SDK, Node.js, and Python.

### Manual Build

**Prerequisites:** Emscripten SDK 4.0.13+, Node.js, autotools (autoconf, aclocal)

```bash
# 1. Generate configure script
./autogen.sh

# 2. Configure for WebAssembly cross-compilation
cd build/wasm
../../configure --host=wasm32-unknown-emscripten

# 3. Build the KL10 variant
cd bld-kl
make

# 4. Download disk/tape images (from repo root)
cd ../../..
./download-images.sh

# 5. Run
cd build/wasm/bld-kl
node serve.js
```

## Architecture

```
Browser (main thread)          Web Worker
┌──────────────────┐    ┌─────────────────────┐
│  index.html      │    │  emulator-worker.js  │
│  main.js         │◄──►│  kn10-kl.wasm        │
│  xterm.js term   │    │  (KLH10 emulator)    │
└──────────────────┘    └─────────────────────┘
        ▲                        ▲
        └───── SharedArrayBuffer ┘
               (ring buffers at offset 0x10000)
```

- **Web Worker** runs the Emscripten-compiled KLH10 emulator in a background thread
- **SharedArrayBuffer** ring buffers provide zero-copy I/O between the terminal and emulator
- **xterm.js** renders a VT100 terminal in the browser
- **Emscripten MEMFS** provides a RAM-based filesystem for disk and tape images

## KL10 vs KS10

This project includes two emulator variants:

| | KL10 (`bld-kl`) | KS10 (`bld-ks`) |
|---|---|---|
| Real hardware | DEC-2065 (mainframe) | DEC-2020 (low-cost) |
| TOPS-20 version | **V7.0** (final release) | V4.1 (1983) |
| Memory | 4 MW (32 MB) | 512 KW (4 MB) |
| Boot method | Pre-installed disk | Install from tape |

**Use the KL10 variant** (`bld-kl`) — it runs the latest TOPS-20 with a pre-installed system.

## Disk and Tape Image Sources

The emulator requires historical software images that are not included in this repository due to their size. The `download-images.sh` script fetches them automatically from public archives.

### KL10 Build — Required Files

| File | Size | Description | Source |
|------|------|-------------|--------|
| `RH20.RP07.1` | 476 MB | Panda TOPS-20 pre-installed RP07 disk | [panda.trailing-edge.com](https://panda.trailing-edge.com/) — from `panda-dist.tar.gz` |
| `boot.sav` | 23 KB | Disk bootstrap loader | In repo: `run/klt20/boot.sav` |
| `mtboot.sav` | 20 KB | Tape bootstrap loader | In repo: `run/klt20/mtboot.sav` |
| `bb-h137f-bm.tap` | 22 MB | DEC TOPS-20 V7.0 install tape (BB-H137F-BM) | [pdp-10.trailing-edge.com](http://pdp-10.trailing-edge.com/tapes/) |

The KL10 config boots from the pre-installed Panda disk image (`RH20.RP07.1`). The install tape (`bb-h137f-bm.tap`) is included for completeness but is not used during normal boot.

### KS10 Build — Required Files

| File | Size | Description | Source |
|------|------|-------------|--------|
| `bb-d867e-bm.tap` | 21 MB | DEC TOPS-20 V4.1 install tape (BB-D867E-BM) | [pdp-10.trailing-edge.com](http://pdp-10.trailing-edge.com/tapes/) |
| `emacs.tap` | 25 MB | EMACS distribution tape | [pdp-10.trailing-edge.com](http://pdp-10.trailing-edge.com/tapes/) |
| `smmtbt-k.sav` | 5.1 KB | KS tape bootstrap | In repo: `tapes/smmtbt-k.sav` |

### Verified Checksums (MD5)

```
1cee5bd59bfcf0a0876360c195293998  RH20.RP07.1
a82ad1f21d28dd5bd905fe24b789eb5c  bb-h137f-bm.tap
c543517319a2b37025531f7d798ebb74  panda.tap
```

### About the Panda Distribution

The [Panda TOPS-20 distribution](https://panda.trailing-edge.com/) was created by Mark Crispin (1langstraat@... at University of Washington). It includes an enhanced TOPS-20 with bugfixes originating from Stanford in the 1970s-80s, plus a library of third-party software. The pre-built RP07 disk image provides a complete, ready-to-boot system.

- Panda distribution archive: https://panda.trailing-edge.com/
- Panda source on GitHub: https://github.com/PDP-10/panda
- DEC tape archive: http://pdp-10.trailing-edge.com/tapes/
- Bitsavers mirror: https://bitsavers.org/bits/DEC/pdp10/magtape/dec_distribs/TOPS-20/

## Project Structure

```
klh10/
├── src/                          # KLH10 C source (~68K lines)
├── build/wasm/
│   ├── bld-kl/                   # KL10 WebAssembly build (recommended)
│   │   ├── index.html            # Browser entry point
│   │   ├── main.js               # Terminal UI controller
│   │   ├── emulator-worker.js    # Web Worker for emulator
│   │   ├── serve.js              # Node.js HTTP server
│   │   ├── tops20-config-commands.txt
│   │   └── tops20-boot-commands.txt
│   └── bld-ks/                   # KS10 WebAssembly build
├── doc/                          # Documentation (install, usage, command ref)
├── run/                          # Native run configurations and boot files
├── tapes/                        # Bootstrap loader files
├── mk/                           # Makefile fragments
├── download-images.sh            # Downloads disk/tape images
├── configure.ac                  # Autotools configuration
└── README                        # Original KLH10 readme with credits
```

## Credits

- **Kenneth L. Harrenstien** — KLH10 emulator author
- **Mark Crispin** — Panda TOPS-20 distribution
- **Upstream repository:** https://github.com/PDP-10/klh10

See `README` for full credits and acknowledgements.

## License

See the `LICENSE` file. The KLH10 software is subject to the terms described therein. Files in the `run/` and `contrib/` directories may have different terms (see `READaux`).
