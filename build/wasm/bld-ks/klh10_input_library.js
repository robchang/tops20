// KLH10 Input Library for Emscripten
// Provides JavaScript implementations of input functions that KLH10 needs

var KLH10InputLibrary = {
  // Global input state - shared with worker
  $KLH10_INPUT: {
    hasInputFn: null,      // Function to check if input available  
    getLineFn: null,       // Function to get next input line
    lineBuffer: null,      // Current line being returned
    linePtr: 0,            // Position in current line
    charBuffer: null,      // Buffer for character-by-character input
    charPos: 0             // Position in character buffer
  },
  
  // Set callback functions from JavaScript
  klh10_set_input_callbacks__sig: 'vpp',
  klh10_set_input_callbacks: function(hasInputCallback, getLineCallback) {
    KLH10_INPUT.hasInputFn = hasInputCallback;
    KLH10_INPUT.getLineFn = getLineCallback;
  },
  
  // Override os_ttyintest - returns 1 if input available, 0 otherwise
  os_ttyintest__sig: 'i',
  os_ttyintest: function() {
    console.log('os_ttyintest called, hasInputFn:', !!KLH10_INPUT.hasInputFn);
    if (KLH10_INPUT.hasInputFn) {
      var result = {{{ makeDynCall('i', 'KLH10_INPUT.hasInputFn') }}}();
      console.log('os_ttyintest returning:', result);
      return result ? 1 : 0;
    }
    console.log('os_ttyintest: no hasInputFn, returning 0');
    return 0;
  },
  
  // Override os_ttycmline - read a line of input into buffer (blocking)
  os_ttycmline__sig: 'ppi', 
  os_ttycmline: function(buffer, size) {
    console.log('os_ttycmline called, buffer:', buffer, 'size:', size, 'getLineFn:', !!KLH10_INPUT.getLineFn);
    if (KLH10_INPUT.getLineFn && buffer && size > 0) {
      // Try to get input immediately
      var jsStringPtr = {{{ makeDynCall('p', 'KLH10_INPUT.getLineFn') }}}(size);
      console.log('os_ttycmline: immediate input check returned ptr:', jsStringPtr);
      
      if (!jsStringPtr) {
        console.log('os_ttycmline: no immediate input, using Asyncify to wait...');
        // No input available - use Asyncify to wait asynchronously
        return Asyncify.handleSleep(function(wakeUp) {
          console.log('os_ttycmline: in async sleep, setting up polling...');
          var checkInput = function() {
            var ptr = {{{ makeDynCall('p', 'KLH10_INPUT.getLineFn') }}}(size);
            if (ptr) {
              console.log('os_ttycmline: async got input ptr:', ptr);
              // Got input - copy to C buffer and wake up
              var jsString = UTF8ToString(ptr);
              if (jsString.length >= size) {
                jsString = jsString.substring(0, size - 1);
              }
              stringToUTF8(jsString, buffer, size);
              _free(ptr); // Free the allocated string
              console.log('os_ttycmline: waking up with buffer:', UTF8ToString(buffer));
              wakeUp(buffer);
            } else {
              // Still no input - check again soon
              setTimeout(checkInput, 50);
            }
          };
          // Start checking for input
          setTimeout(checkInput, 10);
        });
      } else {
        console.log('os_ttycmline: got immediate input');
        // Input available immediately
        var jsString = UTF8ToString(jsStringPtr);
        if (jsString.length >= size) {
          jsString = jsString.substring(0, size - 1);
        }
        stringToUTF8(jsString, buffer, size);
        _free(jsStringPtr); // Free the allocated string
        console.log('os_ttycmline: returning immediate input:', UTF8ToString(buffer));
        return buffer;
      }
    }
    
    console.log('os_ttycmline: no callbacks set, returning NULL');
    return 0; // NULL - no callbacks set
  },
  
  // Override fgets for stdin
  fgets__sig: 'ppip',
  fgets: function(buffer, size, stream) {
    console.log('fgets called, buffer:', buffer, 'size:', size, 'stream:', stream);
    // Check if this is stdin (stream 0 or the actual stdin pointer)
    var isStdin = (stream === 0);
    if (!isStdin) {
      // Try to get the actual stdin value
      try {
        var stdinPtr = getValue(_stdin, 'i32');
        isStdin = (stream === stdinPtr);
      } catch (e) {
        // Ignore error, assume not stdin
      }
    }
    
    if (isStdin && KLH10_INPUT.getLineFn) {
      console.log('fgets: redirecting stdin to our input system');
      // Use our custom input system for stdin
      return os_ttycmline(buffer, size);
    } else if (typeof _fgets !== 'undefined') {
      console.log('fgets: calling original for non-stdin stream');
      return _fgets(buffer, size, stream);
    } else {
      console.log('fgets: no original function available');
      return 0;
    }
  },
  
  // Override getc for stdin  
  getc__sig: 'ip',
  getc: function(stream) {
    console.log('getc called for stream:', stream);
    // Check if this is stdin
    var isStdin = (stream === 0);
    if (!isStdin) {
      try {
        var stdinPtr = getValue(_stdin, 'i32');
        isStdin = (stream === stdinPtr);
      } catch (e) {
        // Ignore error, assume not stdin
      }
    }
    
    if (isStdin && KLH10_INPUT.getLineFn) {
      console.log('getc: redirecting stdin to our input system');
      // For character-by-character input from stdin, we need to buffer
      if (!KLH10_INPUT.charBuffer || KLH10_INPUT.charPos >= KLH10_INPUT.charBuffer.length) {
        // Need a new line
        var tmpBuffer = _malloc(256);
        var result = os_ttycmline(tmpBuffer, 256);
        if (result) {
          KLH10_INPUT.charBuffer = UTF8ToString(tmpBuffer);
          KLH10_INPUT.charPos = 0;
        }
        _free(tmpBuffer);
        if (!result) return -1; // EOF
      }
      
      var ch = KLH10_INPUT.charBuffer.charCodeAt(KLH10_INPUT.charPos++);
      console.log('getc: returning character:', ch, String.fromCharCode(ch));
      return ch;
    } else if (typeof _getc !== 'undefined') {
      console.log('getc: calling original for non-stdin stream');
      return _getc(stream);
    } else {
      console.log('getc: no original function available, returning EOF');
      return -1; // EOF
    }
  },
  
  // Override ioctl to intercept FIONREAD calls for stdin
  ioctl__sig: 'iiii',
  ioctl: function(fd, request, argp) {
    console.log('ioctl called, fd:', fd, 'request:', request, 'argp:', argp);
    
    // Check if this is FIONREAD (0x541B on Linux, varies by system)
    // In Emscripten, FIONREAD is typically defined as 0x541B
    var FIONREAD = 0x541B;
    
    if (fd === 0 && request === FIONREAD && KLH10_INPUT.hasInputFn) {
      console.log('ioctl: intercepting FIONREAD for stdin');
      // Check if we have input available
      var hasInput = {{{ makeDynCall('i', 'KLH10_INPUT.hasInputFn') }}}();
      console.log('ioctl: hasInput =', hasInput);
      
      if (argp) {
        // Write the result to the integer pointed to by argp
        setValue(argp, hasInput ? 1 : 0, 'i32');
        console.log('ioctl: wrote result', hasInput ? 1 : 0, 'to argp');
      }
      
      return 0; // Success
    } else if (typeof _ioctl !== 'undefined') {
      console.log('ioctl: calling original ioctl');
      return _ioctl(fd, request, argp);
    } else {
      console.log('ioctl: no original ioctl, returning -1');
      return -1; // Error
    }
  },
  
  // Override feof to prevent auto-exit when stdin has EOF
  feof__sig: 'ip',
  feof: function(stream) {
    console.log('feof called for stream:', stream, 'hasInputFn:', !!KLH10_INPUT.hasInputFn);
    // For stdin (typically stream 0), never report EOF if we have custom input
    if (KLH10_INPUT.hasInputFn && stream === 0) {
      console.log('feof: preventing EOF for stdin, returning 0');
      return 0; // Never EOF for stdin
    }
    // For other streams, call original function if available
    if (typeof _feof !== 'undefined') {
      var result = _feof(stream);
      console.log('feof: calling original _feof for stream', stream, 'result:', result);
      return result;
    }
    console.log('feof: no original function, returning 0');
    return 0;
  },
  
  // Override ferror to prevent auto-exit when stdin has errors  
  ferror__sig: 'ip',
  ferror: function(stream) {
    console.log('ferror called for stream:', stream, 'hasInputFn:', !!KLH10_INPUT.hasInputFn);
    // For stdin (typically stream 0), never report error if we have custom input
    if (KLH10_INPUT.hasInputFn && stream === 0) {
      console.log('ferror: preventing error for stdin, returning 0');
      return 0; // Never error for stdin
    }
    // For other streams, call original function if available
    if (typeof _ferror !== 'undefined') {
      var result = _ferror(stream);
      console.log('ferror: calling original _ferror for stream', stream, 'result:', result);
      return result;
    }
    console.log('ferror: no original function, returning 0');
    return 0;
  }
};

autoAddDeps(KLH10InputLibrary, '$KLH10_INPUT');
mergeInto(LibraryManager.library, KLH10InputLibrary);