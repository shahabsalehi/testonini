#!/usr/bin/env bash
# Build the launcher for the CURRENT platform. Run this on each target OS:
#   Linux:   ./build.sh            -> dist/TestPractice
#   macOS:   ./build.sh            -> dist/TestPractice.app (universal2 if on Apple Silicon SDK)
#   Windows: ./build.bat  (or bash build.sh under Git Bash / WSL)
set -e
cd "$(dirname "$0")"
pip install --user --break-system-packages pyinstaller reportlab firecrawl-anydoc pymupdf pystray pillow 2>/dev/null || \
  pip install --user pyinstaller reportlab firecrawl-anydoc pymupdf pystray pillow
pyinstaller --onefile --noconsole --name TestPractice \
  --add-data 'index.html:.' --add-data 'style.css:.' --add-data 'app.js:.' --add-data 'pdf.js:.' --add-data 'vendor/pdfjs:vendor/pdfjs' \
  --hidden-import launch_reportlab_marker --hidden-import anydoc \
  --exclude-module cryptography --exclude-module botocore --exclude-module boto3 \
  --exclude-module numpy --exclude-module pandas \
  --exclude-module torch --exclude-module tkinter \
  launch.py
echo "Built: dist/"
echo "Copy dist/TestPractice* plus index.html, style.css, app.js, pdf.js, tests/, pdfs/ next to it."
# macOS onefile produces a Unix executable named TestPractice (no .app bundle). To get a real app bundle:
#   pyinstaller --windowed --name TestPractice --osx-bundle-identifier com.local.exampractice launch.py
