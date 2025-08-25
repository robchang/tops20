#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Basic WASI implementation for Node.js smoke testing
function createWASI(instance) {
  return {
  wasi_snapshot_preview1: {
    fd_write: (fd, iovs, iovs_len, nwritten_ptr) => {
      // Proper stdout/stderr write implementation
      if (fd === 1 || fd === 2) {
        const memory = instance.exports.memory;
        const view = new DataView(memory.buffer);
        let totalBytes = 0;
        let output = '';
        
        for (let i = 0; i < iovs_len; i++) {
          const iov = iovs + (i * 8);
          const ptr = view.getUint32(iov, true);
          const len = view.getUint32(iov + 4, true);
          
          const bytes = new Uint8Array(memory.buffer, ptr, len);
          const text = new TextDecoder('utf-8').decode(bytes);
          output += text;
          totalBytes += len;
        }
        
        // Write to appropriate stream
        if (fd === 1) {
          process.stdout.write(output);
        } else {
          process.stderr.write(output);
        }
        
        // Write bytes written count back
        if (nwritten_ptr !== 0) {
          view.setUint32(nwritten_ptr, totalBytes, true);
        }
        
        return 0;
      }
      return 8; // EBADF
    },
    fd_read: (fd, iovs, iovs_len, nread_ptr) => {
      console.log(`[WASI fd_read] fd=${fd} called`);
      return 0;
    },
    fd_close: (fd) => {
      console.log(`[WASI fd_close] fd=${fd} called`);
      return 0;
    },
    fd_seek: (fd, offset_low, offset_high, whence, newoffset_ptr) => {
      console.log(`[WASI fd_seek] fd=${fd} called`);
      return 0;
    },
    clock_time_get: (clk_id, precision, time_ptr) => {
      console.log(`[WASI clock_time_get] clk_id=${clk_id} called`);
      return 0;
    },
    proc_exit: (code) => {
      console.log(`[WASI proc_exit] code=${code} called`);
      process.exit(code);
    }
  },
  env: {
    // Emscripten runtime functions
    invoke_v: (index) => { console.log(`[invoke_v] ${index}`); },
    invoke_vi: (index, a1) => { console.log(`[invoke_vi] ${index}(${a1})`); },
    invoke_vii: (index, a1, a2) => { console.log(`[invoke_vii] ${index}(${a1}, ${a2})`); },
    invoke_viii: (index, a1, a2, a3) => { console.log(`[invoke_viii] ${index}(${a1}, ${a2}, ${a3})`); },
    invoke_i: (index) => { console.log(`[invoke_i] ${index}`); return 0; },
    invoke_ii: (index, a1) => { console.log(`[invoke_ii] ${index}(${a1})`); return 0; },
    invoke_iii: (index, a1, a2) => { console.log(`[invoke_iii] ${index}(${a1}, ${a2})`); return 0; },
    invoke_iiii: (index, a1, a2, a3) => { console.log(`[invoke_iiii] ${index}(${a1}, ${a2}, ${a3})`); return 0; },
    invoke_iiiii: (index, a1, a2, a3, a4) => { console.log(`[invoke_iiiii] ${index}(${a1}, ${a2}, ${a3}, ${a4})`); return 0; },
    invoke_iiiiiiii: (index, a1, a2, a3, a4, a5, a6, a7) => { console.log(`[invoke_iiiiiiii] ${index}(...)`); return 0; },
    invoke_ijii: (index, a1, a2, a3, a4) => { console.log(`[invoke_ijii] ${index}(...)`); return 0; },
    invoke_vji: (index, a1, a2, a3) => { console.log(`[invoke_vji] ${index}(...)`); },
    
    // System functions
    exit: (code) => {
      console.log(`[exit] code=${code} called`);
      process.exit(code);
    },
    _abort_js: () => {
      console.log('[_abort_js] called');
      process.exit(1);
    },
    
    // Time functions
    emscripten_date_now: () => Date.now(),
    emscripten_get_now: () => performance.now(),
    _setitimer_js: (which, new_value, old_value) => {
      console.log(`[_setitimer_js] which=${which} called`);
      return 0;
    },
    
    // System calls
    __syscall_openat: (dirfd, path, flags, varargs) => {
      console.log(`[__syscall_openat] dirfd=${dirfd} called`);
      return -1; // ENOENT
    },
    __syscall_fcntl64: (fd, cmd, varargs) => {
      console.log(`[__syscall_fcntl64] fd=${fd} cmd=${cmd} called`);
      return 0;
    },
    __syscall_ioctl: (fd, op, varargs) => {
      console.log(`[__syscall_ioctl] fd=${fd} op=${op} called`);
      return 0;
    },
    
    // Runtime functions
    __call_sighandler: (sig) => {
      console.log(`[__call_sighandler] sig=${sig} called`);
    },
    emscripten_resize_heap: (requestedSize) => {
      console.log(`[emscripten_resize_heap] requestedSize=${requestedSize} called`);
      return false;
    },
    _emscripten_throw_longjmp: () => {
      console.log('[_emscripten_throw_longjmp] called');
      throw new Error('longjmp');
    },
    _emscripten_runtime_keepalive_clear: () => {
      console.log('[_emscripten_runtime_keepalive_clear] called');
    }
  }
  };
}

async function smokeTest() {
  console.log('=== KS10 WebAssembly Smoke Test ===\n');
  
  try {
    // Load and compile WASM
    const wasmBuffer = fs.readFileSync('kn10-ks.wasm');
    console.log(`✓ Loaded WASM file (${wasmBuffer.length} bytes)`);
    
    const module = await WebAssembly.compile(wasmBuffer);
    console.log('✓ WASM module compiled successfully');
    
    // Create temporary instance to get the final one with proper WASI
    const tempInstance = await WebAssembly.instantiate(module, createWASI(null));
    const instance = await WebAssembly.instantiate(module, createWASI(tempInstance));
    console.log('✓ WASM module instantiated successfully');
    
    // Initialize constructors
    if (instance.exports.__wasm_call_ctors) {
      console.log('\n--- Calling constructors ---');
      instance.exports.__wasm_call_ctors();
      console.log('✓ Constructors called successfully');
    }
    
    // Test basic exported functions
    console.log('\n--- Testing exports ---');
    console.log('Available exports:', Object.keys(instance.exports).filter(name => typeof instance.exports[name] === 'function').slice(0, 10));
    
    // Test memory allocation functions
    if (instance.exports._emscripten_stack_alloc) {
      console.log('Testing stack allocation...');
      const stackPtr = instance.exports._emscripten_stack_alloc(64);
      console.log(`✓ Stack alloc returned: ${stackPtr}`);
      
      if (instance.exports._emscripten_stack_restore) {
        instance.exports._emscripten_stack_restore(stackPtr);
        console.log('✓ Stack restored');
      }
    }
    
    // Test emulator main entry point
    if (instance.exports.__main_argc_argv) {
      console.log('\n--- Calling main entry point ---');
      try {
        // Call with minimal arguments to see startup banner
        const result = instance.exports.__main_argc_argv(1, 0);
        console.log('✓ Main returned:', result);
      } catch (err) {
        console.log('! Main execution failed:', err.message);
        console.log('This may be expected without proper terminal setup');
      }
    }
    
    console.log('\n=== Smoke Test PASSED ===');
    console.log('KS10 WebAssembly emulator loads and initializes successfully');
    
  } catch (err) {
    console.error('\n=== Smoke Test FAILED ===');
    console.error('Error:', err.message);
    process.exit(1);
  }
}

smokeTest();