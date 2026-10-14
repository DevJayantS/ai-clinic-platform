# Voice2Rx — AI-assisted clinical documentation & prescription drafting

Part of **AI Assisted Clinic & Practice Management Platform**. Lives in the **Patients** section of the
doctor's workspace (`doctor-dashboard.html#patients`).

> ⚠️ Every output is an **AI-generated draft**. Nothing is diagnosed or prescribed by the system; the doctor must
> review and approve. No drug-interaction or allergy checking is performed.

## Run it (Demo Mode — no installs, no keys, offline)

```bash
node voice2rx/server/server.js        # Node 18+, zero npm dependencies
# open http://localhost:8787/doctor-dashboard.html#patients
```

Log in as a doctor first (`doctor-login.html`). **Demo shortcut:** the dashboard only checks
`localStorage.loggedInUser`; use the existing login page.

Serving the repo with any other static server (e.g. `python3 -m http.server`) also works: the UI then runs in
pure **Demo Mode** (no backend, rule-based extraction, session-only storage).

### Demo script (≈2 min)
1. Patients → *Voice2Rx* tab → **Load Sample Consultation** (synthetic *Demo Patient 001*).
2. Watch the 5 stages; open the **Validation & review** panel (missing assessment/plan, medicine needs confirmation).
3. **SOAP Note**: edit a field → its warning clears. **Prescription**: only `paracetamol` is present; strength, dose,
   frequency and duration stay blank because they were never said. Fill them, untick *Needs verification*,
   tick the review box → **Approve**.
4. **Copy**, **Save draft**, **Print / PDF** (demo watermark is printed). Open **Consultation History** → search → **Open & edit**.

## Architecture

```
doctor-dashboard.html ── voice2rx/web/*           UI (vanilla JS, no build step, inline Lucide icons)
                          app.js      presentation + wiring
                          api.js      frontend services (transcribe / extract / consultation store)
                          recorder.js MediaRecorder wrapper (pause/resume, level meter, releases the mic)
voice2rx/shared/clinical.js            schema validation, rule-based extractor, document validation, note builders
                                       (same file runs in the browser AND Node → one source of truth)
voice2rx/server/server.js              local API + static files (http, no deps)
  services/transcriptionService.js     Whisper via Python subprocess (faster-whisper)
  services/clinicalExtractionService.js Ollama adapter (model via env) → schema validation → fallback to rules
  services/validationService.js        API input validation, approval gate
  services/consultationService.js      JSON-file persistence
voice2rx/whisper_service/transcribe.py faster-whisper CLI
```

The existing project is a static HTML/CSS/JS site (no framework, backend or DB), so Voice2Rx follows that stack
rather than introducing React/Tailwind. A small dependency-free Node server was added because browsers cannot run
Whisper/Ollama or persist data safely.

### Safety design
- Extractor/LLM may only copy what is in the transcript; unstated fields stay **empty** and are flagged.
- Medicine rows are created only for named drugs; strength/dose/frequency/duration are filled **only if stated**.
  If one sentence names several drugs, no values are assigned (no guessing).
- LLM output must pass a JSON-schema check; otherwise rule-based extraction is used and the UI says so.
- Deterministic validation re-checks the document against the transcript (e.g. a medicine name not in the transcript is
  a blocking error; patient mismatch; empty transcript). States are descriptive ("Needs review") — no fake confidence scores.
- Approval is blocked while blocking errors exist, rows are flagged, or the review box is unticked. Approved Rx is locked.
- Transcripts are never logged by the server. Audio is never saved (temp file deleted after transcription).
- Nothing leaves the machine; no paid API keys.

## Enable real local AI (optional)

```bash
# 1. Speech-to-text (open-source Whisper)
python3 -m pip install faster-whisper          # first run downloads the model (base ≈ 150 MB)

# 2. Structured extraction (local LLM)
brew install ollama && ollama serve &          # or https://ollama.com/download
ollama pull llama3.1:8b                        # ≈ 4.7 GB disk, ~8 GB RAM

# 3. Config + run
cp voice2rx/.env.example voice2rx/.env         # adjust WHISPER_MODEL / OLLAMA_MODEL if wanted
node voice2rx/server/server.js
```

The header badge shows **Demo Mode** or **Local backend · Whisper ✓/✗ · LLM <model>**. *Settings* shows details and has a
*Force Demo Mode* switch. Change models with `OLLAMA_MODEL` / `WHISPER_MODEL` — no code changes needed. Set
`LLM_PROVIDER=basic` to disable the LLM.

## Tests

```bash
node voice2rx/tests/run.js     # unit + API tests (API part needs the server running)
node voice2rx/tests/e2e.js     # headless Chrome (macOS path) end-to-end demo flow, writes screenshots
```

## Limitations / known issues
- **Persistence**: backend stores a plain JSON file (`voice2rx/server/data/`, git-ignored): unencrypted, no auth, single
  process — development only. Without the backend, drafts live in `sessionStorage` (tab session, **synthetic data only**).
- **No authentication on the API** (the existing login is client-side `localStorage`). Bound to `127.0.0.1` only.
- Rule-based extraction (Demo Mode / fallback) is deliberately simple: English, sentence-level, keyword driven.
  The LLM path is optional and **not exercised in automated tests** (needs Ollama installed).
- Whisper transcription depends on model size/CPU; `base` may mis-hear drug names — the validation panel + source
  quotes exist for this reason. Real microphone recording and Whisper were **not** tested in headless CI (no mic/models).
- Pause/resume depends on browser `MediaRecorder.pause` support.
- Browsers need `localhost` or HTTPS for microphone access.
- Prescription Templates is a labelled placeholder. Print uses the browser print dialog (choose *Save as PDF*).
- Dashboard stats/queue elsewhere on the page are pre-existing static mock data.
- Whisper and the local LLM were tested end to end with synthetic speech (macOS `say`). Live microphone recording was not tested in headless Chrome (no mic).

## Setup actually used on the dev machine (Intel Mac, Python 3.14)
- PyAV and onnxruntime have no wheels for this Python, so `transcribe.py` falls back to the ffmpeg binary from `imageio-ffmpeg` and skips VAD:
  `python3 -m venv voice2rx/.venv && voice2rx/.venv/bin/pip install --no-deps faster-whisper && voice2rx/.venv/bin/pip install ctranslate2 tokenizers huggingface_hub numpy imageio-ffmpeg`
- Homebrew cannot install Ollama on Intel, so the official app binary was unzipped into `voice2rx/.tools/` and started with `voice2rx/.tools/Ollama.app/Contents/Resources/ollama serve`. Model: `llama3.2:3b` (set in the git-ignored `voice2rx/.env`, together with `WHISPER_PYTHON`).
- The 3B model sometimes mis-files items, so its output is merged with the rule-based extractor (hybrid) and always re-validated. A larger model such as `llama3.1:8b` is more accurate but slower.
- Whisper `base` can mishear drug names (amoxicillin was heard as "a Moxasil"); `WHISPER_MODEL=small` is more accurate.
- The sample consultation always uses the instant rule-based path so live demos are repeatable.
