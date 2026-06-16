# AI Job Application Mitra Chrome Extension

This document explains how to build the MVP Chrome Extension + FastAPI backend that reads a LinkedIn job page, extracts the job title/company/description, compares it with a master resume, generates a match analysis, tailored resume, cover letter, DOCX files, and PDF files.

The design is intentionally **human-in-the-loop**. It prepares application material for review. It does not auto-apply, scrape LinkedIn at scale, or submit applications automatically.

---

## 1. Final Project Structure

```text
job-agent/
├── backend/
│   ├── jobsearch.py
│   ├── master_resume.txt
│   ├── .env
│   ├── .venv/
│   └── generated/
│       ├── *_match_analysis.docx
│       ├── *_match_analysis.pdf
│       ├── *_resume.docx
│       ├── *_resume.pdf
│       ├── *_cover_letter.docx
│       └── *_cover_letter.pdf
│
└── extension/
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    ├── content.js
    └── background.js   # optional
```

---

## 2. What the MVP Does

```text
LinkedIn job page
    ↓
Chrome Extension popup
    ↓
content.js extracts job data
    ↓
popup.js sends job data to FastAPI
    ↓
FastAPI loads master_resume.txt
    ↓
OpenAI generates:
    - Match analysis
    - Tailored resume
    - Cover letter
    ↓
Backend saves DOCX files
    ↓
LibreOffice converts DOCX to PDF
    ↓
Popup displays review links
```

---

## 3. Prerequisites

### Required

- Google Chrome
- Python installed via Homebrew
- FastAPI backend
- OpenAI API key with billing/quota enabled
- LibreOffice for PDF export

### Recommended macOS setup

Install Homebrew if needed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Add Homebrew to shell profile if instructed by installer:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.bash_profile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install Python:

```bash
brew install python
```

Install LibreOffice:

```bash
brew install --cask libreoffice
```

Verify:

```bash
which python3
python3 --version
ls /Applications/LibreOffice.app/Contents/MacOS/soffice
```

Expected Python path on Apple Silicon:

```text
/opt/homebrew/bin/python3
```

---

## 4. Backend Setup

Create folders:

```bash
mkdir -p ~/job-agent/backend/generated
cd ~/job-agent/backend
```

Create virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install fastapi uvicorn openai python-dotenv python-docx
```

Create `backend/master_resume.txt` and paste your full master resume:

```text
Amit Singh
408-802-1974 | ...

SUMMARY
...

EXPERIENCE
...
```

Create `backend/.env`:

```text
OPENAI_API_KEY=sk-proj-your-real-key-here
```

Do not commit `.env` to Git.

---

## 5. Backend Script: `backend/jobsearch.py`

Use this structure in your backend. Keep indentation exactly as shown.

```python
from pathlib import Path
from datetime import datetime
import os
import re
import subprocess

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel
from docx import Document

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUT_DIR = Path("generated")
OUTPUT_DIR.mkdir(exist_ok=True)

app.mount("/generated", StaticFiles(directory=str(OUTPUT_DIR)), name="generated")


class JobData(BaseModel):
    url: str = ""
    title: str = ""
    company: str = ""
    description: str = ""


def sanitize_filename_part(text: str) -> str:
    text = text or ""
    text = text.replace("\u00A0", " ")
    text = re.sub(r"[^a-zA-Z0-9_-]+", "_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_") or "unknown"


def load_master_resume() -> str:
    resume_file = Path("master_resume.txt")
    if resume_file.exists():
        return resume_file.read_text(encoding="utf-8")
    return "No master_resume.txt found."


def ask_openai(prompt: str) -> str:
    response = client.responses.create(
        model="gpt-4.1-mini",
        input=prompt,
    )
    return response.output_text


def clean_resume(text: str) -> str:
    if not text:
        return ""

    text = text.replace("Tailored Resume", "").strip()

    unwanted_phrases = [
        "This revised ATS-optimized resume",
        "This ATS-optimized resume",
        "This resume highlights",
        "This tailored resume",
    ]

    for phrase in unwanted_phrases:
        idx = text.find(phrase)
        if idx != -1:
            text = text[:idx]

    return text.strip()


def save_docx(path: Path, title: str, content: str):
    doc = Document()
    doc.add_heading(title, level=1)

    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue

        if line.startswith("- ") or line.startswith("• "):
            doc.add_paragraph(line[2:], style="List Bullet")
        elif line.isupper() and len(line) < 80:
            doc.add_heading(line, level=2)
        else:
            doc.add_paragraph(line)

    doc.save(path)


def convert_docx_to_pdf(docx_path: Path) -> Path:
    subprocess.run(
        [
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(docx_path.parent),
            str(docx_path),
        ],
        check=True,
    )

    return docx_path.with_suffix(".pdf")


@app.get("/")
def health_check():
    return {"status": "ok"}


@app.post("/api/job-packet")
def create_job_packet(job: JobData):
    master_resume = load_master_resume()

    print("======== JOB DATA ========")
    print("TITLE:", repr(job.title))
    print("COMPANY:", repr(job.company))
    print("URL:", repr(job.url))
    print("==========================")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_company = sanitize_filename_part(job.company)
    safe_title = sanitize_filename_part(job.title)

    analysis_filename = f"{timestamp}_{safe_company}_{safe_title}_match_analysis.docx"
    resume_filename = f"{timestamp}_{safe_company}_{safe_title}_resume.docx"
    cover_filename = f"{timestamp}_{safe_company}_{safe_title}_cover_letter.docx"

    analysis_path = OUTPUT_DIR / analysis_filename
    resume_path = OUTPUT_DIR / resume_filename
    cover_path = OUTPUT_DIR / cover_filename

    analysis_prompt = f"""
You are a technical recruiting analyst.

Compare this candidate resume against the job description.

Return ONLY this format:

MATCH SCORE: <0-100>

STRONG MATCHES:
- ...

KEYWORD GAPS:
- ...

RECOMMENDED RESUME CHANGES:
- ...

MASTER RESUME:

{master_resume}

JOB TITLE:

{job.title}

COMPANY:

{job.company}

JOB DESCRIPTION:

{job.description}
"""

    resume_prompt = f"""
You are an expert ATS resume editor.

Your task is NOT to rewrite the entire resume.

Rules:
- Keep employers, dates, titles, and achievements.
- Do not invent experience.
- Do not invent metrics.
- Preserve structure.
- Improve ATS keyword alignment.
- Return ONLY the resume.
- Do not include 'Tailored Resume'.
- Do not include commentary.

MASTER RESUME:

{master_resume}

TARGET ROLE:

{job.title}

COMPANY:

{job.company}

JOB DESCRIPTION:

{job.description}
"""

    cover_prompt = f"""
Write a professional cover letter.

Requirements:
- Use the actual company name.
- Use the actual role title.
- Use 'Dear Hiring Team,' if no hiring manager is known.
- Do not use placeholders.
- Maximum 350 words.
- Return only the cover letter.
- Do not invent experience.

MASTER RESUME:

{master_resume}

COMPANY:

{job.company}

ROLE:

{job.title}

JOB DESCRIPTION:

{job.description}
"""

    match_analysis = ask_openai(analysis_prompt)
    tailored_resume = clean_resume(ask_openai(resume_prompt))
    cover_letter = ask_openai(cover_prompt)

    save_docx(analysis_path, "Match Analysis", match_analysis)
    save_docx(resume_path, "Resume", tailored_resume)
    save_docx(cover_path, "Cover Letter", cover_letter)

    analysis_pdf_path = convert_docx_to_pdf(analysis_path)
    resume_pdf_path = convert_docx_to_pdf(resume_path)
    cover_pdf_path = convert_docx_to_pdf(cover_path)

    return {
        "matchAnalysisUrl": f"http://localhost:8000/generated/{analysis_filename}",
        "matchAnalysisPdfUrl": f"http://localhost:8000/generated/{analysis_pdf_path.name}",
        "resumeUrl": f"http://localhost:8000/generated/{resume_filename}",
        "resumePdfUrl": f"http://localhost:8000/generated/{resume_pdf_path.name}",
        "coverLetterUrl": f"http://localhost:8000/generated/{cover_filename}",
        "coverLetterPdfUrl": f"http://localhost:8000/generated/{cover_pdf_path.name}",
    }
```

Start backend:

```bash
cd ~/job-agent/backend
source .venv/bin/activate
python -m uvicorn jobsearch:app --reload --port 8000
```

Test backend:

```text
http://localhost:8000/docs
```

---

## 6. Chrome Extension Setup

Create folder:

```bash
mkdir -p ~/job-agent/extension
cd ~/job-agent/extension
```

### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Job Application Assistant",
  "version": "0.1.0",
  "description": "Create review-ready resume and cover letter drafts from LinkedIn job pages.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "http://localhost:8000/*"
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/jobs/*"],
      "js": ["content.js"]
    }
  ]
}
```

### `popup.html`

```html
<!doctype html>
<html>
  <body>
    <h3>Job Assistant</h3>
    <button id="generate">Create application packet</button>
    <pre id="status"></pre>
    <script src="popup.js"></script>
  </body>
</html>
```

### `popup.js`

```javascript
document.getElementById("generate").addEventListener("click", async () => {
  const status = document.getElementById("status");

  try {
    status.textContent = "Reading job page...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const jobData = await chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_JOB"
    });

    console.log("Sending to backend:", jobData);

    status.textContent = "Creating application package...";

    const response = await fetch("http://localhost:8000/api/job-packet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(jobData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    const result = await response.json();

    status.textContent =
      `Done!
Match analysis: ${result.matchAnalysisUrl}
Match analysis PDF: ${result.matchAnalysisPdfUrl}
Resume: ${result.resumeUrl}
Resume PDF: ${result.resumePdfUrl}
Cover letter: ${result.coverLetterUrl}
Cover letter PDF: ${result.coverLetterPdfUrl}`;

  } catch (error) {
    console.error(error);
    status.textContent = `Error: ${error.message}`;
  }
});
```

### `content.js`

```javascript
function cleanText(text) {
  return (text || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function getJobData() {
  const pageText = document.body.innerText || "";
  const lines = pageText.split("\n").map(cleanText).filter(Boolean);

  const company =
    cleanText(document.querySelector("a[href*='/company/']")?.innerText) ||
    "unknown";

  let title = cleanText(document.querySelector("h1")?.innerText);

  if (!title) {
    const companyIndex = lines.findIndex(line => line === company);
    if (companyIndex !== -1 && lines[companyIndex + 1]) {
      title = lines[companyIndex + 1];
    }
  }

  if (!title) {
    const metaTitle = cleanText(document.querySelector("meta[property='og:title']")?.content);
    title = metaTitle.split("|")[0].trim();
  }

  let description = "";
  const aboutIndex = lines.findIndex(line => line.toLowerCase() === "about the job");

  if (aboutIndex !== -1) {
    description = lines.slice(aboutIndex + 1).join("\n");
  } else {
    description =
      cleanText(document.querySelector(".jobs-description-content__text")?.innerText) ||
      "Job description not found";
  }

  const jobData = {
    url: window.location.href,
    title,
    company,
    description
  };

  console.log("JOB DATA:", jobData);
  return jobData;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_JOB") {
    sendResponse(getJobData());
  }
});
```

---

## 7. Loading the Extension Locally

1. Open Chrome.
2. Go to:

```text
chrome://extensions
```

3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select:

```text
job-agent/extension
```

Do not select the root `job-agent` folder.

After every change to extension files:

```text
chrome://extensions → Reload extension → Refresh LinkedIn job page
```

---

## 8. Daily Development Workflow

Start backend:

```bash
cd ~/job-agent/backend
source .venv/bin/activate
python -m uvicorn jobsearch:app --reload --port 8000
```

Open LinkedIn job page:

```text
https://www.linkedin.com/jobs/view/<job-id>/
```

Click extension:

```text
Create application packet
```

Expected output:

```text
Done!
Match analysis: http://localhost:8000/generated/..._match_analysis.docx
Match analysis PDF: http://localhost:8000/generated/..._match_analysis.pdf
Resume: http://localhost:8000/generated/..._resume.docx
Resume PDF: http://localhost:8000/generated/..._resume.pdf
Cover letter: http://localhost:8000/generated/..._cover_letter.docx
Cover letter PDF: http://localhost:8000/generated/..._cover_letter.pdf
```

---

# 9. Troubleshooting Guide

This section lists the major issues encountered during the build and how to fix each one.

---

## 9.1 Failed to load extension: Manifest file is missing or unreadable

### Symptom

```text
Failed to load extension
Manifest file is missing or unreadable
Could not load manifest.
```

### Cause

Chrome was pointed to the wrong folder.

### Fix

Load this folder:

```text
job-agent/extension
```

Do not load:

```text
job-agent
```

The selected folder must directly contain:

```text
manifest.json
```

---

## 9.2 Could not load background script

### Symptom

```text
Could not load background script "background.js"
Could not load manifest.
```

### Cause

`manifest.json` referenced `background.js`, but the file did not exist.

### Fix Option A

Create `background.js`:

```javascript
chrome.runtime.onInstalled.addListener(() => {
  console.log("Job Application Assistant installed");
});
```

### Fix Option B

Remove this block from `manifest.json`:

```json
"background": {
  "service_worker": "background.js"
}
```

For the MVP, the background script is optional.

---

## 9.3 Failed to fetch

### Symptom

```text
Uncaught (in promise) TypeError: Failed to fetch
```

### Cause

The extension could not reach the backend.

Common reasons:

- Backend server not running.
- `popup.js` still points to `https://your-backend.com/api/job-packet`.
- `manifest.json` lacks localhost host permission.

### Fix

Start backend:

```bash
cd ~/job-agent/backend
source .venv/bin/activate
python -m uvicorn jobsearch:app --reload --port 8000
```

Update `popup.js`:

```javascript
fetch("http://localhost:8000/api/job-packet", ...)
```

Update `manifest.json`:

```json
"host_permissions": [
  "https://www.linkedin.com/*",
  "http://localhost:8000/*"
]
```

Test backend:

```text
http://localhost:8000/docs
```

---

## 9.4 `python3`, `pip3`, or Xcode Command Line Tools error

### Symptom

```text
xcode-select: note: No developer tools were found, requesting install.
```

or:

```text
Can't install the software because it is not currently available from the Software Update server.
```

### Cause

macOS tried to use Apple developer tools, but Command Line Tools were unavailable.

### Fix

Use Homebrew Python instead:

```bash
brew install python
```

Verify:

```bash
which python3
python3 --version
```

Expected:

```text
/opt/homebrew/bin/python3
```

---

## 9.5 `externally-managed-environment`

### Symptom

```text
error: externally-managed-environment
```

### Cause

Homebrew Python blocks global pip installs.

### Fix

Use a virtual environment:

```bash
cd ~/job-agent/backend
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn openai python-dotenv python-docx
```

---

## 9.6 OpenAI API quota error

### Symptom

```text
RateLimitError
429 insufficient_quota
```

### Cause

The API key is valid, but billing/quota is not available.

### Fix

Check:

```text
https://platform.openai.com/settings/organization/billing
https://platform.openai.com/settings/organization/usage
```

Important: ChatGPT Plus does not automatically include OpenAI API credits.

Test again:

```bash
python test_openai.py
```

Expected:

```text
Response received:
hello
```

---

## 9.7 `.env` not loading

### Symptom

```text
OPENAI_API_KEY not found
```

### Cause

`.env` is missing or placed in the wrong folder.

### Fix

Create:

```text
job-agent/backend/.env
```

With:

```text
OPENAI_API_KEY=sk-proj-your-real-key
```

Run backend from the backend folder:

```bash
cd ~/job-agent/backend
source .venv/bin/activate
python -m uvicorn jobsearch:app --reload --port 8000
```

---

## 9.8 `Could not establish connection. Receiving end does not exist.`

### Symptom

```text
Could not establish connection. Receiving end does not exist.
```

### Cause

`popup.js` tried to message `content.js`, but `content.js` was not loaded on the active page.

### Fix

Make sure the active tab is a LinkedIn job page:

```text
https://www.linkedin.com/jobs/...
```

Then:

```text
chrome://extensions → Reload extension → Refresh LinkedIn page
```

Make sure manifest has:

```json
"content_scripts": [
  {
    "matches": ["https://www.linkedin.com/jobs/*"],
    "js": ["content.js"]
  }
]
```

---

## 9.9 `title is not defined` or `lines is not defined`

### Symptom

```text
ReferenceError: title is not defined
ReferenceError: lines is not defined
```

### Cause

Variables were referenced outside the function where they were declared.

### Fix

Keep all extraction logic inside `getJobData()` or pass variables into helper functions explicitly.

Safe pattern:

```javascript
function getJobData() {
  const pageText = document.body.innerText || "";
  const lines = pageText.split("\n").map(cleanText).filter(Boolean);

  const company = ...;
  let title = ...;

  return { url: window.location.href, title, company, description };
}
```

After editing:

```text
Reload extension → Refresh LinkedIn page
```

---

## 9.10 Generated filenames show `unknown_unknown`

### Symptom

```text
20260613_192233_unknown_unknown_resume.docx
```

### Cause

The extension did not extract title/company correctly.

### Fix

Check browser console on LinkedIn page:

```text
Right click → Inspect → Console
```

Look for:

```javascript
JOB DATA: {
  title: "Senior Technical Program Manager, Product",
  company: "Komodo Health",
  description: "..."
}
```

If `title` or `company` is empty, update `content.js` selectors and reload the extension.

---

## 9.11 Generated cover letter has fake company/person

### Symptom

Cover letter mentions unrelated examples like:

```text
Marketing Manager
GreenLeaf Technologies
Emily Sanders
```

### Cause

The cover letter prompt did not include real variables like company, title, resume, and job description.

### Fix

Make sure `cover_prompt` contains:

```python
MASTER RESUME:
{master_resume}

COMPANY:
{job.company}

ROLE:
{job.title}

JOB DESCRIPTION:
{job.description}
```

Also add guardrails:

```text
Do not use placeholders.
Do not invent experience.
Use the actual company name.
Use the actual role title.
```

---

## 9.12 Resume starts with `Tailored Resume`

### Symptom

Generated resume starts with:

```text
Tailored Resume
Amit Singh
...
```

### Cause

The prompt or DOCX heading added unwanted title text.

### Fix

In prompt:

```text
Do not include 'Tailored Resume'.
Start directly with the candidate name.
```

In backend, use:

```python
save_docx(resume_path, "Resume", tailored_resume)
```

And clean the output:

```python
text = text.replace("Tailored Resume", "").strip()
```

---

## 9.13 `IndentationError` in Python

### Symptom

```text
IndentationError: unexpected indent
IndentationError: unindent does not match any outer indentation level
```

### Cause

Copied code blocks were inserted with wrong indentation or mixed tabs/spaces.

### Fix

Use four spaces consistently.

Run:

```bash
python -m py_compile jobsearch.py
```

If it passes, restart backend:

```bash
python -m uvicorn jobsearch:app --reload --port 8000
```

When adding new code inside `create_job_packet()`, every line must be indented four spaces.

---

## 9.14 `UnboundLocalError: analysis_prompt`

### Symptom

```text
UnboundLocalError: cannot access local variable 'analysis_prompt'
```

### Cause

Code called:

```python
match_analysis = ask_openai(analysis_prompt)
```

before defining `analysis_prompt`.

### Fix

Correct order:

```python
analysis_prompt = f"""..."""
resume_prompt = f"""..."""
cover_prompt = f"""..."""

match_analysis = ask_openai(analysis_prompt)
tailored_resume = clean_resume(ask_openai(resume_prompt))
cover_letter = ask_openai(cover_prompt)
```

---

## 9.15 File URL returns `{"detail":"Not Found"}`

### Symptom

Opening generated file URL returns:

```json
{"detail":"Not Found"}
```

### Causes

- Backend was restarted in the wrong folder.
- File does not exist.
- Filename contains weird spaces or non-breaking spaces.

### Fix

Check file exists:

```bash
cd ~/job-agent/backend
ls -la generated
```

Sanitize filenames:

```python
text = text.replace("\u00A0", " ")
text = re.sub(r"[^a-zA-Z0-9_-]+", "_", text)
```

Make sure backend serves static files:

```python
app.mount("/generated", StaticFiles(directory=str(OUTPUT_DIR)), name="generated")
```

---

## 9.16 PDF links show `undefined`

### Symptom

```text
Resume PDF: undefined
Cover letter PDF: undefined
```

### Cause

Frontend expected PDF fields, but backend did not return them.

### Fix

Backend return must include:

```python
"resumePdfUrl": f"http://localhost:8000/generated/{resume_pdf_path.name}",
"coverLetterPdfUrl": f"http://localhost:8000/generated/{cover_pdf_path.name}",
"matchAnalysisPdfUrl": f"http://localhost:8000/generated/{analysis_pdf_path.name}",
```

---

## 9.17 PDF conversion fails

### Symptom

Backend hangs or errors after DOCX generation.

### Cause

LibreOffice is missing or path is wrong.

### Fix

Install:

```bash
brew install --cask libreoffice
```

Verify:

```bash
ls /Applications/LibreOffice.app/Contents/MacOS/soffice
```

Expected:

```text
/Applications/LibreOffice.app/Contents/MacOS/soffice
```

---

## 9.18 Console shows `chrome-extension://invalid/ net::ERR_FAILED`

### Symptom

Many console errors:

```text
GET chrome-extension://invalid/ net::ERR_FAILED
```

### Cause

Often unrelated Chrome/LinkedIn extension noise or stale DevTools references.

### Fix

Ignore unless your extension fails. Focus on:

- Popup status text
- Backend terminal logs
- `JOB DATA:` console output
- Network request to `http://localhost:8000/api/job-packet`

---

## 9.19 Extension changes not taking effect

### Symptom

Old errors continue even after editing files.

### Cause

Chrome is still running old extension code.

### Fix

Always do all three:

```text
1. Save file
2. chrome://extensions → Reload
3. Refresh LinkedIn job page
```

Content scripts only reload when the page reloads.

---

# 10. Git Repository Instructions

## 10.1 Recommended `.gitignore`

Create `.gitignore` in the repo root:

```gitignore
# Python
__pycache__/
*.py[cod]
.venv/

# Secrets
.env
*.env

# Generated application files
backend/generated/

# Local resume input
backend/master_resume.txt

# macOS
.DS_Store

# Logs
*.log
```

Do not commit:

```text
.env
master_resume.txt
generated/
.venv/
```

These contain secrets, private resume data, and generated personal application documents.

---

## 10.2 Add a Safe Resume Template

Instead of committing your real resume, commit:

```text
backend/master_resume.example.txt
```

Example:

```text
Your Name
email@example.com | linkedin.com/in/example

SUMMARY
...

EXPERIENCE
...
```

Then document:

```bash
cp backend/master_resume.example.txt backend/master_resume.txt
```

---

## 10.3 Add a Safe Environment Template

Commit:

```text
backend/.env.example
```

Contents:

```text
OPENAI_API_KEY=replace-with-your-openai-api-key
```

Then document:

```bash
cp backend/.env.example backend/.env
```

---

## 10.4 Initial Git Commands

From repo root:

```bash
cd ~/job-agent
git init
git add README.md .gitignore backend/jobsearch.py backend/.env.example backend/master_resume.example.txt extension/manifest.json extension/popup.html extension/popup.js extension/content.js
git commit -m "Initial MVP for AI job application assistant"
```

---

## 10.5 Suggested README Sections

Your repository README should include:

```text
Project Overview
Architecture
Setup
Environment Variables
Running Backend
Loading Chrome Extension
Usage
Troubleshooting
Security Notes
Roadmap
```

---

## 10.6 Security Notes for GitHub

Never commit:

- OpenAI API key
- Real resume
- Generated resume/cover letter PDFs
- LinkedIn cookies or credentials
- Any private job application history

If you accidentally commit `.env`:

```bash
git rm --cached backend/.env
git commit -m "Remove accidentally committed env file"
```

Then rotate the API key immediately from OpenAI dashboard.

---

# 11. Roadmap

## Next Useful Enhancements

1. Application history dashboard:

```text
localhost:8000/applications
```

2. Recruiter message generation.
3. Google Drive export.
4. Per-company folder structure.
5. Save metadata JSON per application.
6. Add job status tracking:

```text
Generated → Reviewed → Applied → Interview → Rejected/Offer
```

7. Add job discovery pipeline from company career pages or job APIs.

---

# 12. Safety and LinkedIn Usage Notes

Keep this tool human-in-the-loop.

Recommended use:

```text
Open job manually → Click extension → Review generated documents → Apply manually
```

Avoid:

- Automated LinkedIn scraping at scale
- Auto-clicking Easy Apply
- Auto-submitting applications
- Mass recruiter messaging
- Bypassing LinkedIn limits or access controls

