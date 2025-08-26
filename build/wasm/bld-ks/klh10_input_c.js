// KLH10 Input Library for Emscripten - C function implementations
// Provides the actual C functions that osdsup.c calls

var KLH10InputC = {
  // Global state
  $KLH10_INPUT_STATE: {
    hasInputCallback: null,
    getLineCallback: null,
    initialized: false,
    currentPollTimer: null,  // Track current polling timer
    pendingLine: null,       // Store line that's ready for immediate return
    isWaitingAsync: false    // Track if we're in an async wait
  },
  
  // Initialize callbacks from JavaScript 
  klh10_set_input_callbacks__sig: 'vpp',
  klh10_set_input_callbacks: function(hasInputFn, getLineFn) {
    var buildTime = new Date().toISOString();
    console.log('🔧 BUILD VERIFICATION:', buildTime, '- This confirms you are testing the latest code');
    console.log('klh10_set_input_callbacks called with:', hasInputFn, getLineFn);
    KLH10_INPUT_STATE.hasInputCallback = hasInputFn;
    KLH10_INPUT_STATE.getLineCallback = getLineFn;
    KLH10_INPUT_STATE.initialized = true;
    console.log('Input callbacks initialized');
  },
  
  // Check if input is available (called from os_ttyintest)
  klh10_input_available__sig: 'i',
  klh10_input_available: function() {
    var stack = new Error().stack;
    console.log('klh10_input_available called, initialized:', KLH10_INPUT_STATE.initialized, 'stack:', stack.split('\n')[1]);
    if (KLH10_INPUT_STATE.initialized && KLH10_INPUT_STATE.hasInputCallback) {
      var result = {{{ makeDynCall('i', 'KLH10_INPUT_STATE.hasInputCallback') }}}();
      console.log('klh10_input_available returning:', result);
      return result ? 1 : 0;
    }
    console.log('klh10_input_available: not initialized, returning 0');
    return 0;
  },
  
  // Get a line of input (called from os_ttycmline) 
  klh10_get_line__sig: 'ppi',
  klh10_get_line: function(buffer, size) {
    var stack = new Error().stack;
    console.log('klh10_get_line called, buffer:', buffer, 'size:', size, 'stack:', stack.split('\n')[1]);
    
    // Check if we're already in an async operation
    if (KLH10_INPUT_STATE.currentPollTimer) {
      console.log('klh10_get_line: ERROR - Already in async operation, returning NULL to prevent reentrancy');
      return 0;
    }
    
    if (KLH10_INPUT_STATE.initialized && KLH10_INPUT_STATE.getLineCallback && buffer && size > 0) {
      
      // Try to get input immediately first
      var linePtr = {{{ makeDynCall('pi', 'KLH10_INPUT_STATE.getLineCallback') }}}(size);
      console.log('klh10_get_line: immediate check returned:', linePtr);
      
      if (!linePtr) {
        console.log('klh10_get_line: no immediate input, using Asyncify...');
        console.log('⚠️  ASYNCIFY ENTRY - This is where the problem might be');
        // No input available - wait asynchronously 
        return Asyncify.handleSleep(function(wakeUp) {
          console.log('klh10_get_line: in async sleep, polling for input...');
          
          // Cancel any existing poll timer
          if (KLH10_INPUT_STATE.currentPollTimer) {
            clearTimeout(KLH10_INPUT_STATE.currentPollTimer);
            KLH10_INPUT_STATE.currentPollTimer = null;
          }
          
          var pollForInput = function() {
            try {
              var ptr = {{{ makeDynCall('pi', 'KLH10_INPUT_STATE.getLineCallback') }}}(size);
              if (ptr) {
                console.log('klh10_get_line: async got input:', ptr);
                // Clear the timer since we're done
                KLH10_INPUT_STATE.currentPollTimer = null;
                // Copy the line to the provided buffer
                var inputLine = UTF8ToString(ptr);
                if (inputLine.length >= size) {
                  inputLine = inputLine.substring(0, size - 1);
                }
                stringToUTF8(inputLine, buffer, size);
                _free(ptr);
                console.log('klh10_get_line: waking up with buffer:', UTF8ToString(buffer));
                wakeUp(buffer);
              } else {
                // No input yet, try again
                KLH10_INPUT_STATE.currentPollTimer = setTimeout(pollForInput, 50);
              }
            } catch (error) {
              console.error('klh10_get_line: error in pollForInput:', error);
              KLH10_INPUT_STATE.currentPollTimer = null;
              wakeUp(0); // Return NULL on error
            }
          };
          KLH10_INPUT_STATE.currentPollTimer = setTimeout(pollForInput, 10);
        });
      } else {
        console.log('klh10_get_line: got immediate input');
        // Copy the line to the provided buffer
        var inputLine = UTF8ToString(linePtr);
        if (inputLine.length >= size) {
          inputLine = inputLine.substring(0, size - 1);
        }
        stringToUTF8(inputLine, buffer, size);
        _free(linePtr);
        console.log('klh10_get_line: returning buffer:', UTF8ToString(buffer));
        return buffer;
      }
    }
    
    console.log('klh10_get_line: not initialized or invalid params, returning NULL');
    return 0; // NULL
  }
};

autoAddDeps(KLH10InputC, '$KLH10_INPUT_STATE');
mergeInto(LibraryManager.library, KLH10InputC);