#!/usr/bin/env node
// Test script to verify prompt newline behavior

console.log('Testing prompt newline behavior:');
console.log('');

// Simulate current Module.print() behavior
function simulateModulePrint(text) {
    // Clean up any invalid UTF-8 characters
    const cleanText = text.replace(/[\u00A9]/g, '(C)').replace(/\uFFFD/g, '');
    
    // Check if this is a prompt (KLH10# or KLH10> or KLH10>>)
    const isPrompt = /^KLH10[#>]+\s*$/.test(cleanText.trim());
    
    if (isPrompt) {
        // Prompts should not have newlines added
        process.stdout.write(cleanText);
        console.log('[PROMPT - no newline added]');
    } else {
        // Regular output needs newlines added
        process.stdout.write(cleanText + '\n');
        console.log('[REGULAR OUTPUT - newline added]');
    }
}

console.log('Test 1 - Prompt output:');
simulateModulePrint('KLH10# ');

console.log('\nTest 2 - Regular output:');
simulateModulePrint('KLH10 PDP-10 Emulator v2.0');

console.log('\nTest 3 - Another prompt:');
simulateModulePrint('KLH10> ');

console.log('\nTest 4 - Command run prompt:');
simulateModulePrint('KLH10>> ');

console.log('\nTest 5 - Regular message:');
simulateModulePrint('Type "help" for help, "quit" to quit.');

console.log('\nAll tests completed.');