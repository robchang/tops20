// KLH10 Input Library - No JavaScript callbacks after Asyncify
// This version completely avoids makeDynCall after any async operation

var KLH10InputNoCallback = {
  $KLH10_INPUT_STATE: {
    hasInputCallback: null,
    getLineCallback: null,
    initialized: false,
    inputQueue: [],              // Pre-populated input lines
    asyncWakeUpFunction: null,   // Store wakeUp function from Asyncify
    asyncBuffer: 0,              // Buffer pointer for async operation
    asyncSize: 0,                // Buffer size for async operation
    hasEnteredAsync: false,      // Track if we've ever entered async mode
    _startBackgroundPolling: function() {
      var pollInterval = setInterval(function() {
        try {
          // Only poll if we have callbacks and haven't filled the queue too much
          if (KLH10_INPUT_STATE.initialized && 
              KLH10_INPUT_STATE.getLineCallback && 
              KLH10_INPUT_STATE.inputQueue.length < 5) {
            
            // Get input without being in async context
            var ptr = {{{ makeDynCall('pi', 'KLH10_INPUT_STATE.getLineCallback') }}}(1024);
            if (ptr) {
              var line = UTF8ToString(ptr);
              KLH10_INPUT_STATE.inputQueue.push(line);
              console.log('📥 Pre-populated input:', JSON.stringify(line));
              _free(ptr);
              
              // If we have an async operation waiting, wake it up
              if (KLH10_INPUT_STATE.asyncWakeUpFunction) {
                KLH10_INPUT_STATE._fulfillAsyncRequest();
              }
            }
          }
        } catch (error) {
          console.error('❌ Background polling error:', error);
        }
      }, 50);
    },
    _fulfillAsyncRequest: function() {
      if (!KLH10_INPUT_STATE.asyncWakeUpFunction || KLH10_INPUT_STATE.inputQueue.length === 0) {
        return;
      }
      
      var line = KLH10_INPUT_STATE.inputQueue.shift();
      var buffer = KLH10_INPUT_STATE.asyncBuffer;
      var size = KLH10_INPUT_STATE.asyncSize;
      
      console.log('🎉 Fulfilling async request with:', JSON.stringify(line));
      
      // Copy line to buffer
      if (line.length >= size) line = line.substring(0, size - 1);
      stringToUTF8(line, buffer, size);
      
      // Clean up async state
      var wakeUp = KLH10_INPUT_STATE.asyncWakeUpFunction;
      KLH10_INPUT_STATE.asyncWakeUpFunction = null;
      KLH10_INPUT_STATE.asyncBuffer = 0;
      KLH10_INPUT_STATE.asyncSize = 0;
      
      // Wake up the async operation
      console.log('✅ Waking up async with result:', UTF8ToString(buffer));
      wakeUp(buffer);
    }
  },
  
  klh10_set_mode__sig: 'vi',
  klh10_set_mode: function(mode) {
    console.log('🔄 Mode change:', mode === 1 ? 'COMMAND' : 'RUN');
    // Send mode change to main thread via postMessage
    if (typeof self !== 'undefined' && self.postMessage) {
      self.postMessage({
        type: 'mode_change',
        data: mode === 1 ? 'command' : 'run'
      });
    }
  },
  
  klh10_add_input__sig: 'vp',
  klh10_add_input: function(linePtr) {
    if (!linePtr) return;
    
    var line = UTF8ToString(linePtr);
    KLH10_INPUT_STATE.inputQueue.push(line);
    console.log('📥 Added input to queue:', JSON.stringify(line), 'Queue length now:', KLH10_INPUT_STATE.inputQueue.length);
  },
  
  klh10_set_input_callbacks__sig: 'vpp',
  klh10_set_input_callbacks: function(hasInputFn, getLineFn) {
    var buildTime = new Date().toISOString();
    console.log('🔧 NO-CALLBACK VERSION:', buildTime, '- This is the latest no-callback approach');
    KLH10_INPUT_STATE.hasInputCallback = hasInputFn;
    KLH10_INPUT_STATE.getLineCallback = getLineFn;
    KLH10_INPUT_STATE.initialized = true;
    
    // Background polling disabled - use on-demand input only
    console.log('✅ Input callbacks initialized without background polling');
  },
  
  
  klh10_input_available__sig: 'i',
  klh10_input_available: function() {
    if (!KLH10_INPUT_STATE.initialized) return 0;
    
    var available = KLH10_INPUT_STATE.inputQueue.length > 0;
    // Only log when there IS input to reduce spam
    if (available) {
      console.log('🔍 Input available: YES (queue length:', KLH10_INPUT_STATE.inputQueue.length, ')');
    }
    return available ? 1 : 0;
  },
  
  klh10_get_line__sig: 'ppi',
  klh10_get_line: function(buffer, size) {
    console.log('📞 klh10_get_line called, buffer:', buffer, 'size:', size);
    
    if (!KLH10_INPUT_STATE.initialized || !buffer || size <= 0) {
      console.log('❌ Invalid call to klh10_get_line');
      return 0;
    }

    // If we have queued input, return it immediately
    if (KLH10_INPUT_STATE.inputQueue.length > 0) {
      var line = KLH10_INPUT_STATE.inputQueue.shift();
      console.log('📥 Using queued input:', JSON.stringify(line));
      
      if (line.length >= size) line = line.substring(0, size - 1);
      stringToUTF8(line, buffer, size);
      console.log('✅ Returned queued input successfully');
      return buffer;
    }

    // No immediate input - wait for JavaScript to provide input
    console.log('🚀 No immediate input, entering async wait...');
    
    return Asyncify.handleSleep(function(wakeUp) {
      console.log('😴 Entered async sleep, waiting for input...');
      
      // Store the async operation details for external fulfillment
      KLH10_INPUT_STATE.asyncWakeUpFunction = wakeUp;
      KLH10_INPUT_STATE.asyncBuffer = buffer;
      KLH10_INPUT_STATE.asyncSize = size;
      
      // Check if input becomes available in queue (added by external JavaScript)
      var checkForInput = function() {
        if (KLH10_INPUT_STATE.inputQueue.length > 0) {
          var line = KLH10_INPUT_STATE.inputQueue.shift();
          console.log('📥 Got queued input during async wait:', JSON.stringify(line));
          
          if (line.length >= size) line = line.substring(0, size - 1);
          stringToUTF8(line, buffer, size);
          
          // Clean up async state
          KLH10_INPUT_STATE.asyncWakeUpFunction = null;
          KLH10_INPUT_STATE.asyncBuffer = 0;
          KLH10_INPUT_STATE.asyncSize = 0;
          
          console.log('✅ Waking up with queued input');
          wakeUp(buffer);
          return;
        }
        
        // Continue checking
        setTimeout(checkForInput, 50);
      };
      
      setTimeout(checkForInput, 10);
    });
  }
};

autoAddDeps(KLH10InputNoCallback, '$KLH10_INPUT_STATE');
mergeInto(LibraryManager.library, KLH10InputNoCallback);