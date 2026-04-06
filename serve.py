import http.server, socketserver, os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
with socketserver.TCPServer(("", 8000), NoCacheHandler) as httpd:
    print("Serving on http://127.0.0.1:8000", flush=True)
    httpd.serve_forever()
