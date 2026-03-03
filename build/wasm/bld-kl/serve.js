#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const HOSTNAME = '0.0.0.0'; // Allow external access

// MIME types for web assets
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.ico': 'image/x-icon',
    '.tap': 'application/octet-stream',
    '.sav': 'application/octet-stream',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
};

// Special handling for Emscripten generated files
const getContentType = (filePath) => {
    const extname = path.extname(filePath);
    const basename = path.basename(filePath);
    
    // Handle kn10-ks (Emscripten JS file without extension)
    if (basename === 'kn10-ks' || basename.startsWith('kn10-') && !extname) {
        return 'application/javascript';
    }
    
    return mimeTypes[extname] || 'text/plain';
};

const server = http.createServer((req, res) => {
    // Remove query parameters for file lookup
    const urlPath = req.url.split('?')[0];
    let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const contentType = getContentType(filePath);

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error: ' + error.code);
            }
        } else {
            // Set CORS headers for SharedArrayBuffer support
            // Use 'credentialless' instead of 'require-corp' to allow iframe embedding (e.g. HF Spaces)
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            
            res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
            res.end(content);
        }
    });
});

server.listen(PORT, HOSTNAME, () => {
    console.log(`🚀 KLH10 WebAssembly Emulator Server`);
    console.log(`📡 Serving at http://${HOSTNAME}:${PORT}/`);
    console.log(`🌐 Open in browser to start the PDP-10 emulator`);
    console.log(`📁 Serving files from: ${__dirname}`);
    console.log('');
    console.log('Press Ctrl+C to stop the server');
});

process.on('SIGTERM', () => {
    console.log('\\n👋 Server shutting down...');
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});