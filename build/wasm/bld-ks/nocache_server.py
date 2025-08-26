#!/usr/bin/env python3
import http.server
import socketserver
from http.server import SimpleHTTPRequestHandler
import os

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

PORT = 8088
Handler = NoCacheHTTPRequestHandler

print(f"Serving at http://localhost:{PORT} with no-cache headers")
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()