#!/usr/bin/env python3
"""Launcher: starts the exam app server in this process and opens the browser.
Frozen with PyInstaller this becomes a single double-clickable TestPractice.exe."""
import threading
import time
import webbrowser
import os
import sys

import server  # same folder; PyInstaller bundles it

# Pre-create the user content folders next to the executable so users have a place to drop files.
os.makedirs(server.TESTS, exist_ok=True)
os.makedirs(server.PDFS, exist_ok=True)


def main():
    t = threading.Thread(
        target=server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler).serve_forever,
        daemon=True)
    t.start()
    url = f"http://localhost:{server.PORT}"
    print(f"Serving at {url}  (MCP: {url}/mcp)  — close this window to stop.")
    # Give the socket a beat, then open the default browser
    time.sleep(0.7)
    webbrowser.open(url)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
