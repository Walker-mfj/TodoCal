"""Unprivileged HTTP-to-Unix proxy; no credentials, Docker socket or host shell."""
import base64
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import socket

LIMIT = 1024


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def respond(self, status, result):
        body = json.dumps(result).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            sig = self.headers.get("X-TodoCal-Deploy-Signature", "")
            if self.path != "/deploy" or not 0 < length <= LIMIT or len(sig) != 64:
                return self.respond(400, {"status": "unavailable"})
            body = self.rfile.read(length)
            if len(body) != length:
                return self.respond(400, {"status": "unavailable"})
            envelope = json.dumps({"body": base64.b64encode(body).decode(), "signature": sig}).encode()
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(5)
                connection.connect("/trigger/receiver.sock")
                connection.sendall(envelope + b"\n")
                with connection.makefile("rb") as stream:
                    result = json.loads(stream.readline(1024))
            self.respond(result["code"], {"status": result["status"]})
        except (OSError, ValueError, KeyError):
            self.respond(503, {"status": "unavailable"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
