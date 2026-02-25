# Implementation Plan

> **Note:** Always review the official Emscripten documentation and leverage its provided runtime libraries (FS, TTY, sockets, etc.) wherever possible. Our work should focus only on missing functionality that Emscripten does not already provide. This ensures minimal maintenance burden and maximum compatibility with upstream improvements.

## [Overview]
The goal is to port the KLH10 PDP-10 emulator to WebAssembly. The initial Node.js milestone validated platform detection and build system integration. The port is now complete and runs in the browser with xterm.js terminal, Web Worker threading, and SharedArrayBuffer ring buffer I/O. Primary target: KL10 + TOPS-20 V7.0 (Panda distribution).

This implementation isolates WebAssembly-specific code in a small set of files, preserving the maintainability of the KLH10 codebase. The approach leverages Emscripten’s POSIX compatibility, Autotools cross-compilation, and KLH10’s existing OS abstraction layer.

---

## [Types]
We will extend the type system to support WebAssembly.

- **File**: `src/osdsup.h`  
- **New typedefs**:  
  - `typedef struct timeval osrtm_t;`  
  - `typedef struct timeval ostimer_t;`  
- **Validation**: Ensure these are only active under `#if defined(__EMSCRIPTEN__)`.

---

## [Files]
We will modify platform detection, OS abstraction, and build system files.

- **New files**:  
  - `build/wasm/config.site` → Preconfigure Autotools for cross-compilation.  

- **Modified files**:  
  - `src/cenv.h` → Add `CENV_SYS_EMSCRIPTEN` platform detection.  
  - `src/osdsup.h` → Add WebAssembly-specific typedefs.  
  - `src/osdsup.c` → Add WebAssembly implementations for OS abstraction functions.  
  - `config.sub` → Add `wasm32` CPU and `emscripten` OS recognition.  

- **Unchanged files**: Core emulator sources (`kn10cpu.c`, `klh10.c`, etc.) remain untouched.

---

## [Functions]
We will add WebAssembly-specific implementations of OS abstraction functions.

- **New/Modified functions in `src/osdsup.c`**:  
  - `os_ttyinit()`, `os_ttyreset()`, `os_ttycmdmode()`, `os_ttyrunmode()`  
  - `os_rtmget()`, `os_vrtmget()`, `os_rtmsub()`, `os_rtm_adjust_base()`  
  - `os_timer()`, `os_timer_restore()`, `os_v2rt_idle()`  
  - `os_rtm_tokst()`, `os_rtm_toqct()`  

- **Special handling**:  
  - Add synchronous timer fallback (`CLOCKPOLL()` + `cty_incheck()`) under `__EMSCRIPTEN__`.

---

## [Classes]
No new classes are required. KLH10 is a C project with procedural abstractions. All changes are confined to functions and typedefs.

---

## [Dependencies]
We will integrate Emscripten and Autotools.

- **New dependency**: Emscripten SDK 4.0.13+ (`emcc`, `emconfigure`, `emmake`).
- **Autotools**: `config.sub` recognizes `wasm32-unknown-emscripten`.
- **Build flags** (actual from generated Makefile):
  - `-sINITIAL_MEMORY=134217728` (128MB fixed)
  - `-sALLOW_MEMORY_GROWTH=0`
  - `-sSTACK_SIZE=8388608` (8MB)
  - `-sEXPORTED_FUNCTIONS=_main,_malloc,_free`
  - `-sEXPORTED_RUNTIME_METHODS=callMain,FS,stringToUTF8,UTF8ToString,HEAPU8`  

---

## [Testing]
We will validate the Node.js build.

- **Smoke test**:
  - Run `cd build/wasm/bld-kl && node serve.js`
  - Open http://localhost:8080
  - Click Start Emulator → Load TOPS-20 Config → BOOT TOPS-20
  - Login: operator / dec-20

- **Validation criteria**:
  - No platform detection errors.
  - `osdsup.c` compiles cleanly.
  - `kn10-kl.wasm` (400KB) and `kn10-kl.js` (140KB) generated in `build/wasm/bld-kl/`.  

---

## [Implementation Order]
We will proceed in a structured sequence.

1. Update `config.sub` to recognize `wasm32-unknown-emscripten`.  
2. Add `CENV_SYS_EMSCRIPTEN` to `src/cenv.h`.  
3. Add typedefs to `src/osdsup.h`.  
4. Implement WebAssembly functions in `src/osdsup.c`.  
5. Create `build/wasm/config.site`.  
6. Run `emconfigure ./configure --host=wasm32-unknown-emscripten`.  
7. Run `emmake make -j`.  
8. Validate: `cd build/wasm/bld-kl && node serve.js` → open http://localhost:8080.  
9. Document results in `WASM_PORTING_NOTES.md`.
