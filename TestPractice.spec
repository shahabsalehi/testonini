# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['launch.py'],
    pathex=[],
    binaries=[],
    datas=[('index.html', '.'), ('style.css', '.'), ('app.js', '.'), ('pdf.js', '.')],
    hiddenimports=['launch_reportlab_marker', 'anydoc'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['cryptography', 'botocore', 'boto3', 'numpy', 'pandas', 'fitz', 'torch', 'tkinter'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='TestPractice',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
