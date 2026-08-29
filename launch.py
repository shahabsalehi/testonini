#!/usr/bin/env python3
"""Launcher: starts the exam app server and shows a tray icon to stop it.
Frozen with PyInstaller this becomes a single double-clickable TestPractice(.exe)."""
import threading
import time
import webbrowser
import os
import sys

import server  # same folder; PyInstaller bundles it

# Pre-create the user content folders next to the executable so users have a place to drop files.
os.makedirs(server.TESTS, exist_ok=True)
os.makedirs(server.PDFS, exist_ok=True)


def _make_icon_image():
    """16-32px tray glyph drawn in-code: a filled rounded square with a checkmark."""
    from PIL import Image, ImageDraw
    try:
        import pystray
        sizes = pystray.Icon().LOGO_SIZE if hasattr(pystray, "LOGO_SIZE") else (64, 64)
    except Exception:
        sizes = (64, 64)
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, 60, 60], radius=12, fill="#101828")
    d.line([(18, 34), (28, 44), (46, 22)], fill="#ffffff", width=6, joint="curve")
    return img


def _run_server():
    httpd = server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler)
    httpd.serve_forever()


def main():
    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    url = f"http://localhost:{server.PORT}"

    try:
        import pystray
        from PIL import Image
        tray = pystray.Icon("TestPractice", _make_icon_image(), "Exam Practice")

        def open_app(_icon=None, _item=None):
            import webbrowser
            webbrowser.open(url)

        def quit_app(_icon=None, _item=None):
            tray.stop()
            os._exit(0)  # daemon threads die with it

        import pystray as _p
        tray.menu = _p.Menu(
            _p.MenuItem("Open in browser", open_app, default=True),
            _p.Menu.SEPARATOR,
            _p.MenuItem("Quit", quit_app),
        )
        # open the browser once tray is up
        def _open_once():
            time.sleep(0.7)
            import webbrowser
            webbrowser.open(url)
        threading.Thread(target=_open_once, daemon=True).start()
        tray.run()
    except Exception:
        # No tray environment (or pystray missing) — fall back to console wait.
        print(f"Serving at {url}  (MCP: {url}/mcp)  — Ctrl+C to stop.")
        time.sleep(0.7)
        import webbrowser
        webbrowser.open(url)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()