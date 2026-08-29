#!/usr/bin/env python3
"""testonini local server: static files + optional MCP endpoint (streamable HTTP).

Stdlib only. Run: python3 server.py  (serves http://localhost:5874)
Point any MCP client at http://localhost:5874/mcp  (JSON-RPC 2.0, single endpoint).
Tools: list_tests, get_test, save_test, validate_test — so your own AI can
author tests/ JSON files from PDFs.
"""
import json
import traceback
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.join(ROOT, "tests")
PDFS = os.path.join(ROOT, "pdfs")
HOST, PORT = "127.0.0.1", 5874  # loopback only; 0.0.0.0 would expose the app + MCP to the network

# ---------- validator: mirror of app.js validateTest ----------
def validate_test(t):
    errors = []
    if not isinstance(t, dict) or not isinstance(t.get("questions"), list) or not t["questions"]:
        return ["Test JSON must be an object with a non-empty 'questions' array."]
    nums = set()
    objective_single = {"single_choice", "multiple_choice", "true_false", "matching"}
    has_any_answer = any(q.get("correctAnswer") or q.get("acceptedAnswers")
                         or (isinstance(q.get("prompts"), list) and any(p.get("correctAnswer") for p in q["prompts"]))
                         for q in t["questions"])
    for q in t["questions"]:
        label = f"Q{q.get('number')}" if q.get("number") is not None else str(q.get("id", "(no id)"))
        if q.get("number") is None:
            errors.append(f"{label}: missing 'number'")
        else:
            if q["number"] in nums:
                errors.append(f"{label}: duplicate question number")
            nums.add(q["number"])
        if not q.get("type"):
            errors.append(f"{label}: missing 'type'")
        prompts = q.get("prompts")
        has_subs = isinstance(prompts, list) and len(prompts) > 0
        if not q.get("prompt") and not has_subs:
            errors.append(f"{label}: missing 'prompt'")
        if has_subs:
            if has_any_answer:
                for i, p in enumerate(prompts):
                    if not p.get("correctAnswer"):
                        errors.append(f"{label} item {i+1}: missing correctAnswer")
            if not q.get("matchOptions"):
                errors.append(f"{label}: matchOptions required for matching type")
        elif has_any_answer and q.get("type") in objective_single and not q.get("correctAnswer"):
            errors.append(f"{label}: objective question missing 'correctAnswer'")
        if has_any_answer and q.get("type") == "text_input" and not q.get("acceptedAnswers"):
            errors.append(f"{label}: text_input requires 'acceptedAnswers' array")
        if q.get("type") in {"single_choice", "multiple_choice", "true_false"}:
            opts = q.get("options")
            if not opts:
                errors.append(f"{label}: options required")
            else:
                ids = sorted(o.get("id") for o in opts)
                for a, b in zip(ids, ids[1:]):
                    if a == b:
                        errors.append(f"{label}: duplicate option '{a}'")
    return errors

# ---------- MCP tool handlers ----------
def tool_list_tests(_args):
    files = sorted(f for f in os.listdir(TESTS) if f.endswith(".json")) if os.path.isdir(TESTS) else []
    out = []
    for f in files:
        try:
            with open(os.path.join(TESTS, f), encoding="utf-8") as fh:
                t = json.load(fh)
            out.append({"file": f, "title": t.get("title", f), "questions": len(t.get("questions", []))})
        except Exception as e:
            out.append({"file": f, "error": str(e)})
    return out

def _safe_name(name):
    if not re.fullmatch(r"[\w .()-]+\.json", name) or ".." in name:
        raise ValueError("File name must be simple (letters, digits, spaces, dots, dashes) and end with .json")
    return os.path.join(TESTS, name)

def tool_get_test(args):
    path = _safe_name(args["file"])
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)

def tool_save_test(args):
    os.makedirs(TESTS, exist_ok=True)
    path = _safe_name(args["file"])
    body = args["test"]
    if isinstance(body, str):
        body = json.loads(body)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(body, fh, indent=2, ensure_ascii=False)
    return {"saved": args["file"], "validation_errors": validate_test(body)}

def tool_validate_test(args):
    body = args["test"]
    if isinstance(body, str):
        body = json.loads(body)
    return {"errors": validate_test(body)}

def tool_list_pdfs(_args):
    pd = PDFS
    if not os.path.isdir(pd):
        return []
    return sorted(f for f in os.listdir(pd) if f.lower().endswith(".pdf"))

def tool_prepare_test_from_pdf(args):
    """Return instructions + data an AI agent needs to build a test from a scanned PDF.
    The agent (ChatGPT/Claude/any MCP client) reads the PDF itself, writes the JSON,
    then calls save_test."""
    name = args["file"]
    pd = PDFS
    if not re.fullmatch(r"[\w .()-]+\.pdf", name) or ".." in name:
        raise ValueError("Bad pdf file name")
    path = os.path.join(pd, name)
    if not os.path.isfile(path):
        return {"error": f"{name} not found in pdfs/. Available: {tool_list_pdfs({})}"}
    pages = args.get("pages") or [1, 2, 3, 4, 5]
    out = {"file": name, "servesAt": "/pdfs/" + urllib.parse.quote(name),
           "instruction": (
             "This PDF has little or no selectable text (scanned). Use your own PDF reading "
             "ability (or OCR) to read every question. Build ONE test JSON matching this exact "
             "schema, then call save_test with it. Schema: {title, sourcePdf:'" + name + "', "
             "timeLimitSeconds:number, questions:[{id, number, type, instruction, prompt, "
             "options:[{id,text}]?, correctAnswer (omit if no answer key provided), "
             "acceptedAnswers?:[...], matchOptions?:[{id,text}], prompts?:[{id,text,correctAnswer?}], "
             "minWords?, maxWords?, points}]}. "
             "Allowed types: single_choice, multiple_choice, true_false, text_input, matching, long_text. "
             "NOTE: true_false in IELTS is True/False/Not Given — use options T/F/N. "
             "If the PDF contains no answer key, OMIT every correctAnswer/acceptedAnswers field. "
             "Call save_test with file='" + re.sub(r"\.pdf$", ".json", name) + "')"),
           "textByPage": {}}
    # Best-effort text layer extraction via PyMuPDF if installed (no hard dependency)
    try:
        import fitz
        d = fitz.open(path)
        out["pageCount"] = len(d)
        for pno in pages:
            if 1 <= pno <= len(d):
                t = d[pno - 1].get_text().strip()
                if t:
                    out["textByPage"][str(pno)] = t[:4000]
        if not out["textByPage"]:
            out["textByPage"] = {}
            out["note"] = "No selectable text on probed pages — read the rendered pages at servesAt yourself."
    except Exception:
        out["note"] = "Server-side text extraction unavailable — read the rendered pages at servesAt yourself."
    return out

# ---------- PDF intake endpoint (anydoc + tesseract OCR) ----------
def _ocr_pdf_scanned(filename, dpi=150):
    """Best-effort local OCR of a scanned PDF via tesseract. Returns per-page text dict.
    ponytail: sequential single-thread pass; fine for personal use, thread pool if slow."""
    try:
        import fitz, subprocess, tempfile
    except ImportError:
        return None, "PyMuPDF (fitz) not available for page rendering"
    try:
        subprocess.run(["tesseract", "--version"], capture_output=True, check=True, timeout=10)
    except Exception:
        return None, "tesseract not installed — apt install tesseract-ocr tesseract-ocr-eng"
    path = os.path.join(PDFS, filename)
    d = fitz.open(path)
    texts = {}
    tmpdir = tempfile.mkdtemp()
    for i in range(len(d)):
        png = os.path.join(tmpdir, f"p{i}.png")
        d[i].get_pixmap(dpi=dpi).save(png)
        out = os.path.join(tmpdir, f"o{i}")
        subprocess.run(["tesseract", png, out, "--psm", "4"], capture_output=True, timeout=60)
        if os.path.isfile(out + ".txt"):
            t = open(out + ".txt", encoding="utf-8", errors="replace").read().strip()
            if t:
                texts[str(i + 1)] = t[:4000]
        os.remove(png)
    return texts, None

def parse_pdfs_payload(filename):
    import anydoc
    path = os.path.join(PDFS, filename)
    if not os.path.isfile(path):
        return {"error": "not found", "available": tool_list_pdfs({})}
    try:
        md = anydoc.to_markdown(path)
        return {"file": filename, "status": "text", "markdown": md[:20000],
                "servesAt": "/pdfs/" + urllib.parse.quote(filename),
                "next": "feed this markdown to your AI and ask for a test JSON schema per prepare_test_from_pdf"}
    except anydoc.NeedsOcrError as e:
        out = {"file": filename, "status": "scanned", "pageCount": e.page_count,
               "pages": e.pages, "servesAt": "/pdfs/" + urllib.parse.quote(filename),
               "next": "ask your AI agent to read the rendered pages and call prepare_test_from_pdf"}
        # Local OCR pass so agents/users get raw text without leaving the machine.
        # The AI agent can still produce better JSON from the rendered pages via MCP.
        try:
            texts, err = _ocr_pdf_scanned(filename)
            if texts:
                out["status"] = "scanned-ocr"
                out["ocrTextByPage"] = texts
                out["next"] = ("local OCR text attached (may contain small errors). Build the test JSON from it, "
                               "or read pages visually at servesAt and call prepare_test_from_pdf for better fidelity.")
            elif err:
                out["ocrNote"] = err
        except Exception as oe:
            out["ocrNote"] = "local OCR failed: " + str(oe)
        return out
    except Exception as e:
        return {"file": filename, "status": "error", "error": str(e)}

 
def tool_parse_pdf(args):
    return parse_pdfs_payload(args["file"])

TOOLS = {
    "list_tests": (tool_list_tests, {"type": "object", "properties": {}}),
    "get_test": (tool_get_test, {
        "type": "object", "required": ["file"],
        "properties": {"file": {"type": "string", "description": "File name inside tests/, e.g. sample.json"}}}),
    "save_test": (tool_save_test, {
        "type": "object", "required": ["file", "test"],
        "properties": {"file": {"type": "string"}, "test": {"description": "Test JSON object (or string)"}}}),
    "validate_test": (tool_validate_test, {
        "type": "object", "required": ["test"],
        "properties": {"test": {"description": "Test JSON object (or string)"}}}),
    "list_pdfs": (tool_list_pdfs, {"type": "object", "properties": {}}),
    "parse_pdf": (tool_parse_pdf, {
        "type": "object", "required": ["file"],
        "properties": {"file": {"type": "string", "description": "PDF file name inside pdfs/. Returns markdown text if the PDF has a text layer, or a 'scanned' signal with page list if OCR is needed."}}}),
    "prepare_test_from_pdf": (tool_prepare_test_from_pdf, {
        "type": "object", "required": ["file"],
        "properties": {"file": {"type": "string", "description": "PDF file name inside pdfs/"},
                       "pages": {"type": "array", "items": {"type": "integer"}, "description": "Optional specific 1-based page numbers to extract text from"}}}),
}

def mcp_response(id_, result=None, error=None):
    return {"jsonrpc": "2.0", "id": id_, **({"result": result} if error is None else {"error": error})}

def handle_mcp(msg):
    method = msg.get("method", "")
    id_ = msg.get("id")
    if method == "initialize":
        return mcp_response(id_, {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-03-26"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "testonini", "version": "1.0"},
        })
    if method == "notifications/initialized":
        return None
    if method == "ping":
        return mcp_response(id_, {})
    if method == "tools/list":
        return mcp_response(id_, {"tools": [
            {"name": name, "description": name + " — test authoring for the local exam app",
             "inputSchema": schema}
            for name, (_fn, schema) in TOOLS.items()]})
    if method == "tools/call":
        params = msg.get("params", {})
        name = params.get("name")
        if name not in TOOLS:
            return mcp_response(id_, error={"code": -32602, "message": f"Unknown tool {name}"})
        fn, _ = TOOLS[name]
        try:
            data = fn(params.get("arguments", {}))
            return mcp_response(id_, {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]})
        except Exception as e:
            return mcp_response(id_, {"isError": True, "content": [{"type": "text", "text": str(e)}]})
    if id_ is not None:
        return mcp_response(id_, error={"code": -32601, "message": f"Method not found: {method}"})
    return None

import urllib.parse

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/mcp":
            # streamable HTTP: GET may open SSE or be rejected; answer with liveness
            self._send(405, b"Use POST for MCP JSON-RPC", "text/plain")
            return
        if parsed.path == "/healthz":
            self._send(200, b"ok")
            return
        rel = urllib.parse.unquote(parsed.path).lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self._send(404, b"not found")
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh:
            self._send(200, fh.read(), ctype)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/upload-doc":
            return self._handle_upload_doc()
        if path == "/export-results":
            return self._handle_export_results()
        if path != "/mcp":
            self._send(404, b"not found")
            return
        # /mcp JSON-RPC
        try:
            length = int(self.headers.get("Content-Length", 0))
            msg = json.loads(self.rfile.read(length) or b"null")
        except Exception as e:
            self._send(400, json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(e)}}).encode(), "application/json")
            return
        if isinstance(msg, list):
            replies = [r for m in msg if (r := handle_mcp(m))]
        else:
            replies = [r for r in [handle_mcp(msg)] if r]
        body = json.dumps(replies[0] if len(replies) == 1 else replies, ensure_ascii=False).encode()
        self._send(200, body, "application/json")

    def _handle_upload_doc(self):
        """Multipart upload of one document into pdfs/, then run intake on it.
        ponytail: minimal multipart parser (single file, no nested parts)."""
        ctype = self.headers.get("Content-Type", "")
        m = re.search(r'boundary=([^;]+)', ctype)
        if not m:
            self._send(400, b"multipart/form-data expected", "text/plain")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
        except Exception as e:
            self._send(400, str(e).encode(), "text/plain")
            return
        boundary = m.group(1).encode()
        parts = body.split(b"--" + boundary)
        fname = None
        filedata = None
        for part in parts:
            if b"filename=" in part:
                head, _, data = part.partition(b"\r\n\r\n")
                fm = re.search(rb'filename="([^"]+)"', head)
                if fm:
                    fname = os.path.basename(fm.group(1).decode())
                    filedata = data.rstrip(b"\r\n")
                break
        if not fname or filedata is None:
            self._send(400, b"no file part found", "text/plain")
            return
        if not re.fullmatch(r"[\w .()-]+\.(pdf|docx|doc|rtf|odt|epub|csv|xlsx)", fname):
            self._send(400, b"unsupported file name/type", "text/plain")
            return
        os.makedirs(PDFS, exist_ok=True)
        with open(os.path.join(PDFS, fname), "wb") as fh:
            fh.write(filedata)
        # Intake (may take ~17s for large scans due to OCR; the client shows a progress note)
        try:
            import anydoc  # noqa: F401
            result = parse_pdfs_payload(fname)
        except ImportError:
            result = {"file": fname, "status": "saved-only", "servesAt": "/pdfs/" + urllib.parse.quote(fname)}
        self._send(200, json.dumps(result, ensure_ascii=False).encode(), "application/json")

    def _handle_export_results(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._send(400, str(e).encode(), "text/plain")
            return
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import mm
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
            from reportlab.lib import colors
            from reportlab.lib.styles import getSampleStyleSheet
            import io
            buf = io.BytesIO()
            doc = SimpleDocTemplate(buf, pagesize=A4, title="Exam Results")
            styles = getSampleStyleSheet()
            st = styles["Normal"]
            story = [Paragraph("Exam Results - " + payload.get("title", "Practice Test"), styles["Title"])]
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph("Score: " + payload.get("score", ""), styles["Heading2"]))

            rows = payload.get("rows", [])
            right = [r for r in rows if r.get("verdict") == "RIGHT"]
            wrong = [r for r in rows if r.get("verdict") == "WRONG"]
            manual = [r for r in rows if r.get("verdict") not in ("RIGHT", "WRONG")]

            if right:
                story.append(Spacer(1, 3 * mm))
                story.append(Paragraph("What went well", styles["Heading3"]))
                story.append(Paragraph("Strong areas (answered correctly): " + ", ".join("Q" + str(r["number"]) for r in right) + ".", st))
            if wrong:
                story.append(Spacer(1, 3 * mm))
                story.append(Paragraph("Wrong answers - what to review", styles["Heading3"]))
                for r in wrong:
                    c = str(r.get("correctAnswer", "?"))
                    g = str(r.get("given", "-"))
                    story.append(Paragraph("<b>Q" + str(r["number"]) + "</b>: you answered <b>" + g + "</b>, the correct answer is <b>" + c + "</b>.", st))
            if manual:
                story.append(Spacer(1, 3 * mm))
                story.append(Paragraph("Manual check needed: " + ", ".join("Q" + str(r["number"]) for r in manual) + ". These could not be auto-marked; compare with the answer key by hand.", st))
            story.append(Spacer(1, 4 * mm))

            data = [["#", "Your answer", "Correct", "Verdict"]]
            for r in rows:
                data.append([str(r.get("number", "")), str(r.get("given", "-")),
                             str(r.get("correctAnswer", "")), r.get("verdict", "")])
            t = Table(data, colWidths=[12 * mm, 70 * mm, 50 * mm, 20 * mm])
            t.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]))
            story.append(t)
            if payload.get("notes"):
                story.append(Spacer(1, 4 * mm))
                story.append(Paragraph("Notes", styles["Heading3"]))
                story.append(Paragraph(payload["notes"], st))
            doc.build(story)
            self._send(200, buf.getvalue(), "application/pdf")
        except ImportError as e:
            import traceback as _tb
            self._send(501, (f"PDF export unavailable: {type(e).__name__}: {e}\n" + _tb.format_exc())[:1500].encode(), "text/plain")
        except Exception as e:
            self._send(500, str(e).encode(), "text/plain")


if __name__ == "__main__":
    os.makedirs(TESTS, exist_ok=True)
    print(f"Serving {ROOT} at http://{HOST}:{PORT}  (MCP endpoint: http://{HOST}:{PORT}/mcp)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
