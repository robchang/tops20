# Implementation Plan

> **Note:** Always review the official Emscripten documentation and leverage its provided runtime libraries (FS, TTY, sockets, etc.) wherever possible. Our work should focus only on missing functionality that Emscripten does not already provide. This ensures minimal maintenance burden and maximum compatibility with upstream improvements.

## [Overview]
The goal is to port the KLH10 PDP-10 emulator to WebAssembly with a **Node.js-only milestone** that produces a clean `.wasm` build. This milestone will validate platform detection, build system integration, and minimal device support, ensuring the emulator runs under Node.js with console I/O before moving to browser integration.

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

- **New dependency**: Emscripten SDK (`emcc`, `emconfigure`, `emmake`).  
- **Autotools**: Ensure `config.sub` recognizes `wasm32-unknown-emscripten`.  
- **Build flags**:  
  - `-sENVIRONMENT=node`  
  - `-sALLOW_MEMORY_GROWTH=1`  
  - `-sEXPORTED_FUNCTIONS='["_main"]'`  
  - `-sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS"]'`  

---

## [Testing]
We will validate the Node.js build.

- **Smoke test**:  
  - Run `node ./build/wasm/klh10.js`  
  - Confirm startup banner appears.  
  - Verify console I/O works (prompt responds to input).  

- **Validation criteria**:  
  - No platform detection errors.  
  - `osdsup.c` compiles cleanly.  
  - `.wasm` and `.js` artifacts generated.  

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
8. Validate Node.js execution with `node ./klh10.js`.  
9. Document results in `WASM_PORTING_NOTES.md`.
