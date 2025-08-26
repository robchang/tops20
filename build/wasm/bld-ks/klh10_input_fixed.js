// KLH10 Input Library - Fixed approach to avoid Asyncify reentrancy

var KLH10InputFixed = {
  $KLH10_INPUT_STATE: {
    hasInputCallback: null,
    getLineCallback: null,
    initialized: false,
    pendingLine: null,        // Store line ready for consumption
    waitingForInput: false    // Track if we're actively waiting
  },
  
  klh10_set_input_callbacks__sig: 'vpp',
  klh10_set_input_callbacks: function(hasInputFn, getLineFn) {
    console.log('🔧 BUILD VERIFICATION:', new Date().toISOString(), '- FIXED VERSION LOADED');
    KLH10_INPUT_STATE.hasInputCallback = hasInputFn;
    KLH10_INPUT_STATE.getLineCallback = getLineFn;
    KLH10_INPUT_STATE.initialized = true;
    console.log('✅ Input callbacks initialized');
  },
  
  klh10_input_available__sig: 'i',
  klh10_input_available: function() {
    if (!KLH10_INPUT_STATE.initialized) return 0;
    
    // If we have a pending line, we have input
    if (KLH10_INPUT_STATE.pendingLine) {
      console.log('📋 Input available: pending line exists');
      return 1;
    }
    
    // Check with JavaScript callback
    if (KLH10_INPUT_STATE.hasInputCallback) {
      var result = {{{ makeDynCall('i', 'KLH10_INPUT_STATE.hasInputCallback') }}}();
      console.log('🔍 Input available check:', result ? 'YES' : 'NO');
      return result ? 1 : 0;
    }
    
    return 0;
  },
  
  klh10_get_line__sig: 'ppi',
  klh10_get_line: function(buffer, size) {
    console.log('📞 klh10_get_line called, buffer:', buffer, 'size:', size);
    
    if (!KLH10_INPUT_STATE.initialized || !buffer || size <= 0) {
      console.log('❌ Invalid call to klh10_get_line');
      return 0;
    }

    // First priority: return pending line from previous async operation
    if (KLH10_INPUT_STATE.pendingLine) {
      console.log('📥 Using pending line:', JSON.stringify(KLH10_INPUT_STATE.pendingLine));
      var line = KLH10_INPUT_STATE.pendingLine;
      KLH10_INPUT_STATE.pendingLine = null;
      
      if (line.length >= size) line = line.substring(0, size - 1);
      stringToUTF8(line, buffer, size);
      console.log('✅ Returned pending line successfully');
      return buffer;
    }

    // Second priority: try immediate input
    if (KLH10_INPUT_STATE.getLineCallback) {
      try {
        var linePtr = {{{ makeDynCall('pi', 'KLH10_INPUT_STATE.getLineCallback') }}}(size);
        if (linePtr) {
          console.log('📥 Got immediate input');
          var inputLine = UTF8ToString(linePtr);
          if (inputLine.length >= size) inputLine = inputLine.substring(0, size - 1);
          stringToUTF8(inputLine, buffer, size);
          _free(linePtr);
          console.log('✅ Returned immediate input successfully');
          return buffer;
        }
      } catch (error) {
        console.error('❌ Error getting immediate input:', error);
        return 0;
      }
    }

    // Third priority: async wait (but only if not already waiting)
    if (KLH10_INPUT_STATE.waitingForInput) {
      console.log('⏳ Already waiting for input, returning NULL (caller should retry)');
      return 0;
    }

    console.log('🚀 No immediate input, starting async wait...');
    KLH10_INPUT_STATE.waitingForInput = true;
    
    // Use Asyncify ONLY ONCE per session
    return Asyncify.handleSleep(function(wakeUp) {
      console.log('😴 Entered async sleep, will poll for input...');
      
      var pollForInput = function() {
        try {
          if (KLH10_INPUT_STATE.getLineCallback) {
            var ptr = {{{ makeDynCall('pi', 'KLH10_INPUT_STATE.getLineCallback') }}}(size);
            if (ptr) {
              console.log('🎉 Got input in async mode!');
              var inputLine = UTF8ToString(ptr);
              if (inputLine.length >= size) inputLine = inputLine.substring(0, size - 1);
              
              // Copy directly to buffer for this call
              stringToUTF8(inputLine, buffer, size);
              _free(ptr);
              
              KLH10_INPUT_STATE.waitingForInput = false;
              console.log('✅ Waking up with input:', UTF8ToString(buffer));
              wakeUp(buffer);
              return;
            }
          }
          
          // No input yet, continue polling
          setTimeout(pollForInput, 50);
        } catch (error) {
          console.error('❌ Error in async polling:', error);
          KLH10_INPUT_STATE.waitingForInput = false;
          wakeUp(0);
        }
      };
      
      // Start polling
      setTimeout(pollForInput, 10);
    });
  }
};

autoAddDeps(KLH10InputFixed, '$KLH10_INPUT_STATE');
mergeInto(LibraryManager.library, KLH10InputFixed);