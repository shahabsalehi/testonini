# Security & Verification Notes

This file documents the security model, what the automated verification covers,
and known limitations. Last updated for release v0.1.5.

## Security model

- The server listens on the loopback interface only — 127.0.0.1 (IPv4) and ::1 (IPv6).
  It is unreachable from other machines, including the local network.
- All state (tests, PDFs, settings) stays on the local disk in `tests/` and `pdfs/`
  next to the executable. The application makes **no outbound network connections**:
  PDF.js is vendored into the binary, there is no telemetry, no accounts, and no CDN.
- MCP tool calls (used by the user's own AI assistant for test authoring) are also
  loopback-only and restricted to the same two folders.

## Applied hardening

- DOM-safe rendering: untrusted strings from test JSON or AI-authored content never
  reach `innerHTML`; all display nodes are built with `textContent` / DOM APIs.
- Content-Security-Policy: `script-src 'self'` — no inline scripts, no remote code.
- Path validation on every file route: strict filename patterns, rejection of
  traversal sequences, `realpath` containment inside the two data folders.
- Atomic file writes (`temp` + `fsync` + `replace`) for test persistence and uploads.
- Request guards: body-size limits, cross-origin rejection, malformed JSON-RPC
  handled without crashing.
- ReportLab export: user-supplied strings XML-escaped before rendering.

## Verification

Every release build runs an isolated smoke test (binary alone, no accompanying
files) against the health endpoint, static assets, and the vendored PDF.js module.
SHA-256 checksums are published per binary so downloads can be verified.

## Residual risks (accepted)

- Local trust: any process running as the same user can read the two data folders.
- The MCP endpoint has no authentication — it is meant for the user's own local
  AI assistant.
- The binaries are not signed with an Authenticode / Apple Developer certificate;
  see the release notes for the consequence (SmartScreen / Gatekeeper prompts on
  first run).
