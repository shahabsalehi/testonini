@echo off
REM Windows build: run from an Administrator-free cmd. Requires Python 3.10+ on PATH.
cd /d "%~dp0"
pip install --user pyinstaller reportlab firecrawl-anydoc pymupdf pystray pillow
pyinstaller --onefile --noconsole --name TestPractice ^
  --add-data "index.html;." --add-data "style.css;." --add-data "app.js;." --add-data "pdf.js;." --add-data "vendor\pdfjs;vendor/pdfjs" ^
  --hidden-import launch_reportlab_marker --hidden-import anydoc ^
  --exclude-module cryptography --exclude-module botocore --exclude-module numpy ^
  --exclude-module pandas --exclude-module tkinter \^
  launch.py
echo Built dist\TestPractice.exe
echo Copy it plus index.html, style.css, app.js, pdf.js, tests\, pdfs\ next to it.
