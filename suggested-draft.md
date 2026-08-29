# Project Plan: Personal Online Exam Mimic (ponytail cut, v2)

Personal, locally-used exam-simulation web app. No hosting, no auth, no accounts, no server
database. A person authors or imports a test, then takes it in an environment that mimics a
real computer-based exam (Pearson/Vue-style), so practice feels like the real thing.

Design principle (from the original draft, kept):
> A structured digital assessment engine — not a PDF viewer with answer fields.
> Functional familiarity, never visual cloning of a commercial exam product.

Applications named after real test brands (structured JSON vs. PDF delivery) are excluded;
generic exam-exam UI is not.

---

## 1. Architecture (all local, zero install)

```text
┌──────────────────────────────────────┐
│ index.html + app.js + style.css      │  vanilla JS, no framework, no build
│ PDF.js from CDN renders source PDF   │
│ Data: localStorage + test .json files│
└──────────┬───────────────────────────┘
           │ only when AI-assisted authoring is wanted
┌──────────▼───────────────────────────┐
│ server.py  (optional, ~150 lines)    │  Python stdlib only
│  • serves this app at localhost:8787 │
│  • MCP streamable-HTTP endpoint      │  works with Claude Desktop AND
│    (localhost MCP, stdio→none needed)│  ChatGPT desktop/web connectors
└──────────────────────────────────────┘
```

- Double-click `index.html` works with zero server (tests via JSON import/export +
  localStorage). `server.py` exists for the MCP path only.
- PostgreSQL, workers, queues, object storage, auth, roles, audit logs: **removed**.
- The original v1 PDF-processing pipeline (extraction, OCR, confidence scoring, review
  screen, templates, AI extraction worker) is **removed** — see §3.

## 2. User roles

One. The user is administrator, creator, reviewer, and candidate simultaneously.
All role/assignment/access-code machinery is gone.

## 3. Test authoring — AI does the conversion, MCP makes it zero-effort

PDF→structured-test conversion is the expensive part of any exam platform. Decision:
**we do not build an extraction pipeline.** The user's own AI (ChatGPT, Claude, anything
that speaks MCP) is the extraction engine; our app only defines the schema and ingests it.

Three authoring paths, in order of decreasing effort:

1. **MCP (recommended, optional):** user connects `localhost:8787/mcp` to their AI client
   once. In-app notice: *"For AI-assisted authoring, share the local MCP server with your
   AI assistant, open the PDF with it, and ask it to build the test."* The server exposes a
   minimal tool surface:
   - `list_tests` / `get_test` / `save_test` — read/write test JSON under `tests/`
   - `validate_test` — runs §9's validator, returns its findings
   The AI reads the PDF, produces structured JSON, saves it, iterates on validation errors.
   Zero extraction code on our side.
2. **Clipboard fallback (no MCP needed):** one button exports a prompt + the JSON schema;
   user pastes it into any AI chat with the PDF, pastes the result back as a `.json`
   import. ponytail's lazier path — costs ~20 lines, works even when MCP isn't available.
3. **Hand-written JSON:** schema is small; a second authoring attempt may add a minimal
   in-app builder if JSON editing proves annoying. Deferred until it hurts.

## 4. Data model (kept nearly verbatim from v1 §10–11)

Test = one JSON file. Hierarchy: Test → Module → Section → (Passage ref) → Question Group →
Questions. Module/section labels are free text (supports any exam format).

Question fields: `id`, `number`, `type`, `instruction`, `prompt`, `passageRef?`, `options?`,
`correctAnswer` (id | array | string[] accepted answers), `points`.
Writing tasks: `prompt` + `minWords/maxWords`, scored by the user afterwards, not auto.

MVP question types (six, per v1 §62):
`single_choice`, `multiple_choice`, `text_input`, `true_false`, `matching`, `long_text`.
Everything else from v1 (table completion, diagram/map labeling, drag-drop) is deferred
indefinitely. Answers are entered in the right-hand question pane only; the PDF pane stays
read-only.

## 5. Exam shell (the actual product — the real-exam feel)

- Timer in the header; per-test or per-module time limits; auto-submit at zero. Timer is
  client-side: for personal use a wall-clock check against the saved start time is enough.
- Question palette: ○ unanswered / ● answered / ⚑ flag-for-review / ◉ current. States
  combine (answered + flagged). Click to jump.
- Previous/Next; free navigation within the module; review summary before submit
  (answered / unanswered / flagged counts).
- Reading split-screen: PDF.js left, questions right. Fixed ratio, no resizable divider
  (YAGNI). Minimum desktop viewport 1024px; a "use a bigger screen" note otherwise.
- Writing: plain `<textarea>` + live word count. No rich text, no grammar features.
- Autosave answers to localStorage continuously; reopening restores the in-progress attempt.
- No fullscreen/proctoring gimmicks, no highlighting/notes engine, no audio (all deferred;
  none affect the core exam feel).

## 6. Scoring & results

- Objective types: auto-scored after submission. `text_input` matches case-insensitively
  against an accepted-answers list.
- Writing: scored manually by the user via a simple criteria form on the results screen.
- Results screen: score, per-question right/wrong with correct answers shown, wall time.
- No analytics dashboard, no history charts (localStorage already keeps past results; a
  results list is trivial to show later if wanted).

## 7. Files

```text
index.html   — markup for shell, import, results
app.js       — state, timer, palette, rendering, scoring
style.css    — split-screen + exam chrome
server.py    — optional: static file serving + MCP HTTP endpoint + tests/ file IO
tests/       — test .json files (portable, versionable, human- and AI-editable)
```

Four files plus sample tests. Everything MIT/OSS: PDF.js (Apache-2.0, CDN), Python stdlib.

## 8. Build order

1. Schema + validator (`validate_test` logic, shared by server tool and app)
2. Exam shell: render one section, timer, palette, navigation, autosave
3. Question components (the six types) + split-screen PDF pane
4. Scoring + results screen
5. JSON import/export + sample test
6. `server.py` + MCP tools + the in-app MCP notice
7. (Deferred) in-app authoring builder

## 9. Validator (before a test is takeable)

Every question has a unique number, a usable prompt, and — for objective types — an answer.
Group instructions non-empty. Match options A–Z contiguous. Writing tasks have word limits.
Failures list item by item; same output whether triggered from the app or the MCP tool.