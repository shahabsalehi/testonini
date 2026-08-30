# Security audit — TestPractice (last updated at release v0.1.3, commit 8b76976)

## Model-assisted scan (DeepSec 2.3.7 / Codex gpt-5.6-sol)
Attempts: 3 (plans dsr-f0bd…, dsr-a956…, d0a00…, bdf3ae…).
All model batches failed inside the pinned sandbox with:
`invalid peer certificate: UnknownIssuer` on wss://chatgpt.com — a TLS-trust bug
in the sandbox's egress proxy vs. the bundled Codex CLI. 0 analyses completed
across 4 attempts; doctor reports healthy but live wss fails. Conclusion:
DeepSec is currently non-functional in this environment; no findings can be
claimed from it. Retain this note as the honest record.

## Deterministic verification performed (all passing)
- Bind: TCP listener is 127.0.0.1:5874 only. `0.0.0.0` appears nowhere in source.
- Path safety: every file route validates names via `re.fullmatch([\w .()-]+\.(…))`
  and rejects `..`; static GET additionally `normpath`+`startswith(ROOT)`.
- No auth/secret surface: no accounts, no telemetry, no outbound calls except the
  optional PDF.js CDN script fallback.
- MCP endpoint: localhost-only, 7 tools, no filesystem scope beyond tests/ pdfs/ roots.
- Repo hygiene: no secrets in history (verified via `git log -S` and fresh-clone
  rescan of every commit); tailnet hostname never committed; screenshot leak
  scrubbed from remote by history rewrite (force-push), verified by fresh clone.
- Temp/scratch: DeepSec local state destroyed after each run (adapter-reported).

## Residual risks (accepted, documented)
- Local trust: anything running as the local user can read tests/pdfs (by design —
  no multi-user model).
- MCP on loopback: any local process can call it; that is the point of the feature.
- PDF.js is vendored since the packaging fix (no CDN fallback, zero outbound calls).
  The dynamic import is restricted to the same-origin /vendor/… path.
