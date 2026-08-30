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

# --noconsole leaves this process with None std streams (pythonw semantics).
# Anything that writes to them (socketserver.handle_error, http.server request
# logging, traceback, pystray) then dies with AttributeError(NoneType) — see
# server.py Handler.log_message for the request-path half of this fix.
for _name in ("stdin", "stdout", "stderr"):
    if getattr(sys, _name, None) is None:
        setattr(sys, _name, open(os.devnull, "r" if _name == "stdin" else "w"))

# Pre-create user content folders next to the executable so users have a place to drop files.
os.makedirs(server.TESTS, exist_ok=True)
os.makedirs(server.PDFS, exist_ok=True)

URL = f"http://127.0.0.1:{server.PORT}"  # numeric — never depends on "localhost" resolving (VPNs/DNS can hijack it)


def _fatal(msg):
    """Show the error even under --noconsole (no visible console), then exit.

    Also appends to testpractice-error.log next to the exe: a noconsole failure
    with no trace is undebuggable on a user's machine."""
    try:
        base = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(base, "testpractice-error.log"), "a", encoding="utf-8") as fh:
            fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n\n")
    except Exception:
        pass
    try:
        import ctypes
        if sys.platform == "win32":
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


def _wait_and_open_browser(timeout=30.0):
    """/healthz must answer before the browser opens — verifies the full request
    path (accept -> handler -> response bytes), not just the bind.

    Runs on the MAIN thread BEFORE the tray icon exists: serve_forever threads are
    independent OS threads, so waiting here cannot starve them (and ctypes/win32
    tray code is not yet running). A failure here shows a dialog with no zombie
    tray left behind. Long timeout because antivirus can delay the first loopback
    connection to an unsigned binary while it scans the process."""
    accepted_no_reply = False
    deadline = time.time() + timeout
    while time.time() < deadline:
        for host in ("127.0.0.1", "::1"):  # numeric — no DNS involved, both stacks covered
            try:
                s = socket.create_connection((host, server.PORT), timeout=3)
                s.sendall(b"GET /healthz HTTP/1.0\r\nHost: localhost\r\n\r\n")
                data = s.recv(64)
                s.close()
                if b"200" in data:
                    webbrowser.open(URL)
                    return
                accepted_no_reply = True  # TCP accepted, zero HTTP bytes back
            except OSError:
                continue
        time.sleep(0.5)
    if accepted_no_reply:
        # TCP works but the handler never wrote a response: a server bug, not a
        # firewall. (This was the signature of the --noconsole log_message crash.)
        _fatal("The server accepted the connection but never sent a response.\n\n"
               "This is a bug in TestPractice, not a firewall or VPN problem.\n"
               "The details were written to testpractice-error.log next to the program.\n"
               "Please report it: https://github.com/shahabsalehi/testonini/issues")
    _fatal("The server bound its port but did not respond to a loopback health check within 30 s.\n\n"
           "Most likely causes:\n"
           "  • Antivirus / endpoint protection blocking unsigned executables from binding ports\n"
           "  • VPN software (Tailscale, ZeroTier, corporate VPN) with WFP callouts filtering loopback\n"
           "  • Windows Firewall with a deny rule\n\n"
           "The binary is built from public source; see https://github.com/shahabsalehi/testonini\n"
           "for the code and a SHA-256 to verify the file you downloaded.")


def main():
    servers = _bind_server()  # synchronous bind: visible errors first
    for srv in servers:
        threading.Thread(target=srv.serve_forever, daemon=True).start()

    # Health gate on the main thread, before the tray: prove requests answer,
    # open the browser, and only then show the tray icon.
    _wait_and_open_browser()

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
        tray.run()
    except Exception:
        # No tray environment — fall back to console wait (server is already
        # healthz-verified above).
        print(f"Serving at {URL}  (MCP: {URL}/mcp)  — Ctrl+C to stop.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
