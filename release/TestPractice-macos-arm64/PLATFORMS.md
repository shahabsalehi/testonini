# Building and running TestPractice on each OS

The app = Python stdlib server + static web UI. PyInstaller freezes it per platform.
PyInstaller cannot cross-compile: run the build ON each target OS (or in a VM/CI runner).

## Linux (any x86_64 / arm64)
    ./build.sh          # -> dist/TestPractice (ELF binary)
Optional OCR of scanned PDFs: apt install tesseract-ocr tesseract-ocr-eng
Without it, scanned PDFs still work — the app just tells the AI agent to read pages visually.

## Windows 10 / 11
    build.bat           # -> dist\TestPractice.exe
Optional OCR: install https://github.com/UB-Mannheim/tesseract/wiki (add to PATH) or UB Mannheim installer.

## macOS (Intel 2014+, Apple Silicon M1/M2/M3)
    ./build.sh          # -> dist/TestPractice
- PyInstaller ships universal2 when built on a Mac with both SDK slices available;
  to target older Intel Macs explicitly, build with a python.org universal2 installer
  (supports macOS 10.13+ for recent Pythons; use Python 3.10 universal2 for 10.13–10.15 Intel).
- The binary is unsigned; first open: right-click → Open (bypasses Gatekeeper).
- Tesseract for OCR: brew install tesseract

## What to ship next to the binary (the "app" is the folder)
    TestPractice(.exe)  index.html  style.css  app.js  pdf.js  tests/  pdfs/

## Runtime requirements
- Nothing to install for the user: server + UI + reportlab + anydoc are frozen inside.
- PDF.js: loads from vendored path first, CDN fallback; fully offline except that fallback.
- OCR needs the platform tesseract binary; everything else is optional-degradation.
