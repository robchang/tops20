// Test script for KLH10 input flow implementation
const fs = require('fs');

// Mock the global environment for our worker
global.self = global;
global.importScripts = function(script) {
    // Load the Emscripten-generated module
    require('./' + script);
};
global.postMessage = function(message) {
    console.log('Worker message:', message);
};

// Load the emulator worker
console.log('Loading emulator worker...');
require('./emulator-worker.js');

// Test the input flow
console.log('Testing input flow implementation...');

// Check if our input library was built correctly
if (fs.existsSync('./klh10_input_library.js')) {
    console.log('✓ Input library file exists');
    const libraryContent = fs.readFileSync('./klh10_input_library.js', 'utf8');
    
    if (libraryContent.includes('os_ttyintest') && libraryContent.includes('os_ttycmline')) {
        console.log('✓ Input library contains required function overrides');
    } else {
        console.log('✗ Input library missing required function overrides');
    }
    
    if (libraryContent.includes('KLH10_INPUT')) {
        console.log('✓ Input library contains KLH10_INPUT object');
    } else {
        console.log('✗ Input library missing KLH10_INPUT object');
    }
} else {
    console.log('✗ Input library file not found');
}

// Check if the binary was built with input support
if (fs.existsSync('./kn10-ks')) {
    console.log('✓ KLH10 binary exists');
    
    // Check file size to ensure it's reasonable
    const stats = fs.statSync('./kn10-ks');
    console.log(`  Binary size: ${stats.size} bytes`);
    
    if (stats.size > 100000) {
        console.log('✓ Binary size looks reasonable for full build');
    } else {
        console.log('⚠ Binary size seems small, may be incomplete');
    }
} else {
    console.log('✗ KLH10 binary not found');
}

console.log('Input flow test complete. Check web interface for actual functionality.');