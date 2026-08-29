# TestPractice — local exam simulator

Drop an exam PDF in, get a real-feel computer test: timed, split-screen with the
source document, question palette, flagging, auto-marking, and downloadable
results PDF. Runs entirely on your machine.

## Get a build
Push a tag (`git tag v0.1 && git push --tags`) → GitHub Actions builds one binary per
platform (Windows, Linux, macOS Intel + Apple Silicon) → download from the run's
Artifacts section. The binary is self-sufficient: web UI ships inside it, and
`tests/` + `pdfs/` folders are created on first run next to it.

## Local development
    python3 server.py        # serves http://localhost:5874  (MCP: /mcp)
    # or double-click a built binary

## Layout
    server.py    stdlib HTTP server: static files, /upload-doc, /export-results, MCP JSON-RPC
    launch.py    launcher: starts server, opens browser
    index.html / app.js / style.css / pdf.js    the app (vanilla, no build step)
    tests/       test JSON files (validator contract in server.py validate_test / app.js validateTest)
    pdfs/        your exam documents
