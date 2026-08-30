#!/usr/bin/env python3
"""Launcher: starts the exam app server and shows a tray icon to stop it.
Frozen with PyInstaller this becomes a single double-clickable TestPractice(.exe)."""
import threading
import time
import webbrowser
import os
import sys
import socket

import server  # same folder; PyInstaller bundles it

# Pre-create user content folders next to the executable so users have a place to drop files.
os.makedirs(server.TESTS, exist_ok=True)
os.makedirs(server.PDFS, exist_ok=True)

URL = f"http://localhost:{server.PORT}"


def _fatal(msg):
    """Show the error even under --noconsole (no visible console), then exit."""
    try:
        import ctypes, sys as _s
        if _s.platform == "win32":
            ctypes.windll.user32.MessageBoxW(0, msg, "TestPractice", 0x10)
        else:
            print(msg)
    except Exception:
        pass
    sys.exit(1)


def _make_icon_image():
    """Tray glyph drawn in-code: dark rounded square with a white checkmark."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, 60, 60], radius=12, fill="#101828")
    d.line([(18, 34), (28, 44), (46, 22)], fill="#ffffff", width=6, joint="curve")
    return img


def _bind_server():
    """Bind synchronously (both loopback stacks) so a failure is visible before the browser opens."""
    try:
        return server._make_server()
    except OSError as e:
        import errno as _errno
        in_use = e.errno == _errno.EADDRINUSE or getattr(e, "winerror", None) == 10048
        if in_use:
            _fatal(f"Port {server.PORT} is already in use — is TestPractice already running?\n"
                   f"Close the other instance (check the system tray) or restart your machine, then try again.")
        _fatal(f"Could not bind to loopback port {server.PORT}\n\n{e}\n\n"
               f"Another program may be using this port, or Windows Firewall blocked it.\n"
               f"Allow TestPractice through the firewall when prompted and retry.")


def _wait_and_open_browser():
    """/healthz must answer before the browser opens — verifies THIS server is live."""
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            s = socket.create_connection(("localhost", server.PORT), timeout=1)  # same resolution path the browser takes
            s.sendall(b"GET /healthz HTTP/1.0\r\nHost: localhost\r\n\r\n")
            data = s.recv(64)
            s.close()
            if b"200" in data:
                webbrowser.open(URL)
                return
        except OSError:
            pass
        time.sleep(0.3)
    _fatal(f"The server started but did not answer on {URL}. A firewall or antivirus may be blocking it.")


def main():
    servers = _bind_server()  # synchronous bind: visible errors first
    for srv in servers:
        threading.Thread(target=srv.serve_forever, daemon=True).start()

    try:
        import pystray
        tray = pystray.Icon("TestPractice", _make_icon_image(), "Exam Practice")

        def open_app(_icon=None, _item=None):
            webbrowser.open(URL)

        def quit_app(_icon=None, _item=None):
            tray.stop()
            os._exit(0)  # daemon threads die with it

        import pystray as _p
        tray.menu = _p.Menu(
            _p.MenuItem("Open in browser", open_app, default=True),
            _p.Menu.SEPARATOR,
            _p.MenuItem("Quit", quit_app),
        )
        threading.Thread(target=_wait_and_open_browser, daemon=True).start()
        tray.run()
    except Exception:
        # No tray environment — fall back to console wait, still healthz-first.
        print(f"Serving at {URL}  (MCP: {URL}/mcp)  — Ctrl+C to stop.")
        _wait_and_open_browser()
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
