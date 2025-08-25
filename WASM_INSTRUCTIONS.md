# Task

You are an expert at porting complex C applications to new platforms. You have in-depth knowledge of C, Gnu Autotools, and porting strategies.

Your task is to port KLH10 PDP-10 emulator to Webassembly and run a standalone version of TOPS-20 in the browser for demonstration purposes. The browser 
will use xterm.js to provide a VT100 'termina' within the web page.

As this project is already running on Unix;  this is a porting project and we should concentrate on identifying differences between the Unix platform and web assembly, and isolate those changes. This is a standard approach to creating maintainable cross-platform projects.

# Porting Strategy

The project has been architected to be easily ported to other Unix-like systems. You should thoroughly understand the design and treat  webassembly+enscript as a new target.

**Key Principle**: Keep KLH10 codebase unchanged and isolate all WebAssembly code in a small set of files. KLH10 project is organized to allow this.

# Technical Requirements


## Minimal Configuration Strategy
- Core emulator: CPU, memory, basic I/O
- Essential devices: Console (dvcty), DTE (dvdte)
- Excluded: Complex device drivers (vdisk, vmtape, networking)
- Stub implementations: Device management, process control, timing
- Browser compatibility: Focus on core functionality over Unix features

# Simplifiers

As this will be a standalone demo, you can use the following simplifiers:
- Browser: Chrome only
- Shared Memory: Not needed. You can pre-allocate necessary memory (Modern browser has plenty of scale)
- Fork: Not needed for device drivers
- Networking: Not needed
- Filesystem: Ephemeral - can be RAM based
- Signals: Only CTRL-C (SigInt) needed and possibly timers
- Complex Devices: Exclude vdisk, vmtape, networking drivers
- Device Processes: Minimal stubs for device management

# UX Requirements
- Use xterm.js in VT100 emulation mode to display the PDP-10 console. Emulator must run in a worker thread to prevent blocking the main UX thread.

# Resources
- KLH10 Emulator project: [ https://github.com/PDP-10/klh10 ]
- Emscripten project: [ https://emscripten.org ] 
- TOPS-20 tape images: in tapes directory
- Xtermjs project: [ https://github.com/xtermjs/xterm.js ]

# Development Plan

Review the documentation and source code *thoroughly* and propose a plan to port the emulator. As this is a complex project, there should be clear development milestones where we can confirm the project is converging towards success.  

# Platform Detection Strategy

Before attempting compilation, investigate the project's platform detection system:
- Look for files like cenv.h, platform.h, os*.h with PLATFORM_* or OS_* macros
- Check if autotools config.sub recognizes wasm32-unknown-emscripten target  
- Multiple "Unimplemented OS routine" errors usually indicate platform detection issues, not missing individual functions

Key files to examine: klh10/src/cenv.h, klh10/src/osdsup.h, klh10/config.sub

**Critical Insight**: Most porting failures occur when the project's platform detection system doesn't recognize the new target. Investigate platform detection architecture before attempting individual function fixes.

**Build System Priority**: This project uses autotools. Success requires proper cross-compilation setup (config.sub updates, config.site configuration) rather than manual configuration file creation.

# Success Indicators

Milestone validation:
- Platform detection: Emulator startup shows "compiled for unknown-emscripten on wasm32"
- OS abstraction: osdsup.c compiles without platform errors
- Build system: emconfigure generates proper config.h
- Functionality: Console I/O working, command prompt appears
- Final test: `node -e "require('./klh10.js');"` shows startup banner

# Common Pitfalls

**Error Pattern Recognition**:
- 20+ "Unimplemented OS routine" errors → Platform detection issue (architecture-level fix needed)
- "Invalid configuration" errors → Build system target recognition issue  
- "undefined symbol: custom_type_t" → Type definition missing in headers
- Individual function errors → Implementation gap (only address after above resolved)

**Efficiency Strategy**: 15 minutes of error classification saves hours of misdirected effort. Focus on architecture-level issues before individual function implementation.

**BASH commands**: if you chain commands, do not escape the & character.
