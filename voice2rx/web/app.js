/* Voice2Rx UI. Business logic lives in V2RClinical / V2RApi; this file is presentation + wiring. */
(function () {
    "use strict";
    var C = window.V2RClinical, I = window.V2RIcons, Api = window.V2RApi, Sample = window.V2RSample, PATIENTS = window.V2RPatients;
    var Recorder = window.V2RRecorder;
    var root = document.getElementById("v2rRoot");
    if (!root) return;

    // ------------------------------------------------------------------ utils
    function $(sel) { return root.querySelector(sel); }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function mmss(ms) { var s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
    // Short pause between processing stages so each stage is readable on screen. The stages themselves really run.
    function pace() { return sleep(350); }

    var user = {};
    try { user = JSON.parse(localStorage.getItem("loggedInUser")) || {}; } catch (e) { }
    var doctorName = user.name || "Doctor";

    var STAGE_DEFS = [
        { key: "audio", title: "Audio captured" },
        { key: "transcribe", title: "Speech transcription" },
        { key: "extract", title: "Clinical information extraction" },
        { key: "validate", title: "Validation & uncertainty checks" },
        { key: "note", title: "Clinical note generation" }
    ];

    var SOAP = [
        { l: "S", t: "Subjective", f: [["subjective", "chiefComplaint", "Chief complaint", 2], ["subjective", "symptoms", "Symptoms & duration", 3], ["subjective", "history", "Relevant patient-reported history", 3]] },
        { l: "O", t: "Objective", f: [["objective", "examination", "Examination findings", 3], ["objective", "vitals", "Vital signs (only if provided)", 2], ["objective", "tests", "Test results (only if provided)", 2]] },
        { l: "A", t: "Assessment", f: [["assessment", "assessment", "Clinician-stated assessment", 3]] },
        { l: "P", t: "Plan", f: [["plan", "investigations", "Investigations", 2], ["plan", "treatment", "Treatment plan stated by the doctor", 3], ["plan", "followUp", "Follow-up instructions", 2]] }
    ];
    var MED_LABELS = [["name", "Medicine name"], ["strength", "Strength"], ["dose", "Dose"], ["route", "Route"], ["frequency", "Frequency"], ["timing", "Timing / food"], ["duration", "Duration"]];
    var NOTICE = "AI-generated draft \u2014 verify all clinical information before approval.";
    var AUDIO_EXT = [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg", ".opus", ".flac", ".aac", ".aiff", ".aif"];
    var MAX_AUDIO = 50 * 1024 * 1024;

    // ------------------------------------------------------------------ state
    var state, recorder = null;

    function freshState(keep) {
        keep = keep || {};
        return {
            page: keep.page || "workspace", tab: "soap", patientId: keep.patientId || "",
            transcript: "", transcriptSource: "", processedTranscript: "", audio: null,
            stages: STAGE_DEFS.map(function (s) { return { key: s.key, title: s.title, state: "pending", detail: "" }; }),
            doc: null, issues: [], consultationId: null, dirty: false, processing: false, extractionInfo: null,
            backend: keep.backend || null, forceDemo: keep.forceDemo || false, setupNeeded: false, rec: "idle",
            histQ: keep.histQ || "", histStatus: keep.histStatus || "all", histPatient: keep.histPatient || ""
        };
    }

    function patient() { return PATIENTS.find(function (p) { return p.id === state.patientId; }) || null; }
    function usingServer() { return Api.reachable && !state.forceDemo; }
    function canTranscribe() { return usingServer() && state.backend && state.backend.whisper && state.backend.whisper.available; }
    function isDemoData() { return state.transcriptSource === "demo-sample"; }

    // ------------------------------------------------------------------ toasts
    function toast(msg, type) {
        type = type || "ok";
        var box = $("#v2rToasts");
        var el = document.createElement("div");
        el.className = "v2r-toast " + type;
        el.setAttribute("role", type === "err" ? "alert" : "status");
        el.innerHTML = I(type === "ok" ? "check" : type === "err" ? "xcircle" : "info") + "<span>" + esc(msg) + "</span>";
        box.appendChild(el);
        setTimeout(function () { el.remove(); }, type === "err" ? 6500 : 3500);
    }

    // ------------------------------------------------------------------ shell
    function buildShell() {
        root.innerHTML =
            '<div class="v2r">' +
            '<header class="v2r-top"><div class="v2r-title"><h1>Voice2Rx</h1><p>AI-assisted clinical documentation and prescription drafting. Every output is a draft for the doctor to verify.</p></div>' +
            '<div class="v2r-top-controls">' +
            '<label class="v2r-field" for="v2rPatient">Patient<select id="v2rPatient" data-bind="patient"></select></label>' +
            '<span class="v2r-pill" id="v2rStatus"></span><span class="v2r-pill" id="v2rMode"></span>' +
            '<div class="v2r-doc"><span class="av">' + esc(doctorName.replace(/^dr\.?\s*/i, "").charAt(0).toUpperCase() || "D") + '</span><div><strong>' + esc(doctorName) + '</strong><small>Medical Doctor</small></div></div>' +
            "</div></header>" +
            '<nav class="v2r-nav" role="tablist" aria-label="Voice2Rx sections">' +
            [["workspace", "mic", "Voice2Rx"], ["patients", "users", "Patients"], ["history", "clock", "Consultation History"], ["templates", "clip", "Prescription Templates"], ["settings", "cog", "Settings"]]
                .map(function (n) { return '<button role="tab" data-action="page" data-page="' + n[0] + '" id="v2rNav-' + n[0] + '">' + I(n[1]) + n[2] + (n[0] === "templates" ? ' <span class="soon">Placeholder</span>' : "") + "</button>"; }).join("") +
            "</nav>" +
            '<section id="v2rPage-workspace" role="tabpanel" aria-labelledby="v2rNav-workspace">' + workspaceHtml() + "</section>" +
            '<section id="v2rPage-patients" role="tabpanel" aria-labelledby="v2rNav-patients" hidden></section>' +
            '<section id="v2rPage-history" role="tabpanel" aria-labelledby="v2rNav-history" hidden></section>' +
            '<section id="v2rPage-templates" role="tabpanel" aria-labelledby="v2rNav-templates" hidden></section>' +
            '<section id="v2rPage-settings" role="tabpanel" aria-labelledby="v2rNav-settings" hidden></section>' +
            '<div class="v2r-toasts" id="v2rToasts" aria-live="polite"></div></div>';
    }

    function workspaceHtml() {
        return '<div class="v2r-grid">' +
            // ---- left
            '<div class="v2r-col">' +
            '<section class="v2r-card" aria-labelledby="v2rH1"><h2 id="v2rH1">' + I("mic") + " Recording</h2>" +
            '<p class="sub">Audio is processed on this machine only. Raw audio is not saved with the consultation.</p>' +
            '<div class="v2r-rec"><button class="v2r-mic" id="v2rMic" data-action="rec-start" aria-label="Start recording">' + I("mic") + "</button>" +
            '<div><div class="v2r-time" id="v2rTime">00:00</div><div class="v2r-rec-status" id="v2rRecStatus" aria-live="polite">Ready to record</div></div></div>' +
            '<div class="v2r-meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="v2rMeter"><i id="v2rLevel"></i></div>' +
            '<div class="v2r-row">' +
            '<button class="v2r-btn" data-action="rec-pause" id="v2rPause">' + I("pause") + "Pause</button>" +
            '<button class="v2r-btn" data-action="rec-resume" id="v2rResume">' + I("play") + "Resume</button>" +
            '<button class="v2r-btn danger" data-action="rec-stop" id="v2rStop">' + I("stop") + "Stop</button>" +
            '<button class="v2r-btn" data-action="upload" id="v2rUpload">' + I("upload") + "Upload audio</button>" +
            '<input type="file" id="v2rFile" hidden accept="audio/*,' + AUDIO_EXT.join(",") + '" aria-label="Upload audio file"></div>' +
            '<div id="v2rRecError" role="alert"></div><div id="v2rAudioBox"></div><div id="v2rSetup"></div></section>' +

            '<section class="v2r-card" aria-labelledby="v2rH2"><div class="v2r-tx-head" style="margin-top:0"><h2 id="v2rH2">' + I("file") + " Transcript</h2><span id=\"v2rTxBadge\"></span></div>" +
            '<textarea id="v2rTranscript" data-bind="transcript" aria-label="Transcript (editable)" placeholder="The transcript appears here. You can also type or paste a transcript, or load the sample consultation."></textarea>' +
            '<div id="v2rTxNote"></div>' +
            '<div class="v2r-row" style="margin-top:12px">' +
            '<button class="v2r-btn primary" data-action="process" id="v2rProcess">' + I("zap") + "Process consultation</button>" +
            '<button class="v2r-btn" data-action="retry-transcribe" id="v2rRetryTx">' + I("refresh") + "Retry transcription</button>" +
            '<button class="v2r-btn" data-action="sample">' + I("flask") + "Load Sample Consultation</button>" +
            '<button class="v2r-btn" data-action="new" title="Clear everything and start over">' + I("plus") + "New</button></div></section>" +
            "</div>" +
            // ---- middle
            '<div class="v2r-col"><section class="v2r-card" aria-labelledby="v2rH3"><h2 id="v2rH3">' + I("zap") + " AI processing</h2>" +
            '<p class="sub">Each stage reports what actually ran.</p><ol class="v2r-stages" id="v2rStages"></ol><div id="v2rStageErr"></div></section>' +
            '<section class="v2r-card" aria-labelledby="v2rH4"><h2 id="v2rH4">' + I("shield") + ' Validation &amp; review</h2>' +
            '<p class="sub">Deterministic checks against the transcript. States are descriptive, not a medical-correctness score.</p><div id="v2rIssues"></div></section></div>' +
            // ---- right
            '<div class="v2r-col v2r-col-out"><section class="v2r-card" aria-labelledby="v2rH5"><h2 id="v2rH5">' + I("clip") + " Clinical output</h2><div style=\"height:12px\"></div>" +
            '<div class="v2r-tabs" role="tablist" aria-label="Clinical output">' +
            [["soap", "SOAP Note"], ["rx", "Prescription"], ["summary", "Summary"]].map(function (t) { return '<button role="tab" data-action="tab" data-tab="' + t[0] + '" id="v2rTab-' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>" +
            '<div id="v2rOutEmpty" class="v2r-empty">' + I("file") + 'No draft yet. Record or upload audio, enter a transcript, then press <b>Process consultation</b>.<br><br><button class="v2r-btn primary" data-action="sample">' + I("flask") + "Load Sample Consultation</button></div>" +
            '<div id="v2rPanel-soap" role="tabpanel" hidden></div><div id="v2rPanel-rx" role="tabpanel" hidden></div><div id="v2rPanel-summary" role="tabpanel" hidden></div>' +
            "</section></div></div>";
    }

    // ------------------------------------------------------------------ small renderers
    function renderPatientSelect() {
        var sel = $("#v2rPatient");
        var opts = '<option value="">Select patient\u2026</option>' + PATIENTS.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (p.id === state.patientId ? " selected" : "") + ">" + esc(p.name) + (p.id !== p.name ? " (" + esc(p.id) + ")" : "") + "</option>";
        }).join("");
        sel.innerHTML = opts;
    }

    function updateStatus() {
        var el = $("#v2rStatus"), label, cls = "";
        var rx = state.doc && state.doc.prescription;
        if (state.rec === "recording") { label = "Recording"; cls = "rec"; }
        else if (state.rec === "paused") { label = "Recording paused"; cls = "warn"; }
        else if (state.processing) { label = "Processing"; cls = "blue"; }
        else if (rx && rx.approved) { label = "Prescription approved"; cls = "ok"; }
        else if (state.doc) { label = state.dirty || !state.consultationId ? "Draft ready \u00b7 unsaved" : "Draft saved"; cls = state.dirty || !state.consultationId ? "warn" : "ok"; }
        else if (state.transcript.trim()) { label = "Transcript ready"; cls = "blue"; }
        else label = "Not started";
        el.className = "v2r-pill " + cls;
        el.innerHTML = '<span class="dot"></span>Consultation: ' + label;
    }

    function updateMode() {
        var el = $("#v2rMode"), b = state.backend;
        if (!usingServer()) {
            el.className = "v2r-pill warn";
            el.innerHTML = '<span class="dot"></span>Demo Mode' + (Api.reachable ? " (forced)" : " \u00b7 no local AI backend");
            el.title = "Real transcription is unavailable. Extraction uses simple rules, not an AI model.";
        } else {
            var parts = ["Whisper " + (b.whisper.available ? "\u2713" : "\u2717"), b.llm.available ? "LLM " + b.llm.model : "LLM \u2717 (rule-based)"];
            el.className = "v2r-pill " + (b.whisper.available && b.llm.available ? "ok" : "blue");
            el.innerHTML = '<span class="dot"></span>Local backend \u00b7 ' + esc(parts.join(" \u00b7 "));
            el.title = "Local Voice2Rx server connected";
        }
    }

    function renderStages() {
        $("#v2rStages").innerHTML = state.stages.map(function (s, i) {
            var mk = s.state === "done" ? I("check") : s.state === "processing" ? I("loader", "spin") : s.state === "error" ? I("xcircle") : s.state === "skipped" ? I("check") : String(i + 1);
            var label = { done: "Completed", processing: "In progress", pending: "Pending", error: "Failed", skipped: "Skipped" }[s.state];
            return '<li class="v2r-stage ' + s.state + '"><span class="mk">' + mk + '</span><div><strong>' + esc(s.title) + '</strong><small>' + esc(s.detail || label) + "</small></div></li>";
        }).join("");
        var failed = state.stages.find(function (s) { return s.state === "error"; });
        $("#v2rStageErr").innerHTML = failed
            ? '<div class="v2r-banner err" style="margin-top:14px">' + I("alert") + "<div><b>" + esc(failed.title) + " failed.</b> " + esc(failed.detail) + '<div style="margin-top:8px"><button class="v2r-btn sm" data-action="retry-stage" data-stage="' + failed.key + '">' + I("refresh") + "Retry</button></div></div></div>"
            : "";
    }

    function setStage(key, st, detail) {
        var s = state.stages.find(function (x) { return x.key === key; });
        s.state = st; s.detail = detail || "";
        renderStages(); updateStatus();
    }

    function refreshAudioStage() {
        if (state.stages[0].state === "processing") return;
        if (state.audio) setStage("audio", "done", "Audio ready (" + (state.audio.name || "recording") + (state.audio.durationMs ? ", " + mmss(state.audio.durationMs) : "") + ")");
        else if (state.transcriptSource === "demo-sample") setStage("audio", "skipped", "Demo sample \u2014 no audio recorded");
        else if (state.transcript.trim()) setStage("audio", "skipped", "No audio \u2014 transcript entered manually");
        else setStage("audio", "pending");
    }

    function renderRecUI() {
        var r = state.rec, supported = Recorder.supported();
        $("#v2rMic").disabled = r !== "idle" || state.processing;
        $("#v2rMic").classList.toggle("active", r === "recording");
        $("#v2rPause").disabled = r !== "recording";
        $("#v2rResume").disabled = r !== "paused";
        $("#v2rStop").disabled = r === "idle";
        $("#v2rUpload").disabled = r !== "idle";
        $("#v2rRecStatus").textContent = r === "recording" ? "Recording\u2026" : r === "paused" ? "Paused" : (supported ? "Ready to record" : "Recording not supported in this browser \u2014 upload audio instead");
        updateStatus();
    }

    function showRecError(msg) {
        $("#v2rRecError").innerHTML = msg ? '<div class="v2r-banner err" style="margin-top:12px">' + I("xcircle") + "<div>" + esc(msg) + "</div></div>" : "";
    }

    function renderAudioBox() {
        var a = state.audio;
        $("#v2rAudioBox").innerHTML = a
            ? '<audio controls src="' + esc(a.url) + '" aria-label="Recorded audio"></audio><p class="sub" style="margin:6px 0 0">' + esc(a.name || "Recording") + " \u00b7 " + Math.round(a.blob.size / 1024) + " KB</p>"
            : "";
    }

    function renderSetup() {
        var box = $("#v2rSetup");
        if (!state.setupNeeded) { box.innerHTML = ""; return; }
        var why = Api.reachable ? (state.backend.whisper.reason || "Whisper is not available.") : "The local Voice2Rx server is not running.";
        box.innerHTML = '<div class="v2r-banner warn" style="margin-top:12px">' + I("alert") + "<div><b>Real transcription is not configured.</b> " + esc(why) +
            "<pre>pip install faster-whisper\nnode voice2rx/server/server.js\n# then open http://localhost:8787/doctor-dashboard.html#patients</pre>" +
            'Until then you can type/paste a transcript, or use Demo Mode. Audio will <b>not</b> be transcribed in Demo Mode.' +
            '<div class="v2r-row" style="margin-top:10px"><button class="v2r-btn sm primary" data-action="sample">' + I("flask") + 'Load Sample Consultation</button><button class="v2r-btn sm" data-action="dismiss-setup">Dismiss</button></div></div></div>';
    }

    function renderTxMeta() {
        var src = { "demo-sample": ["Demo sample \u00b7 synthetic", "demo"], whisper: ["Local Whisper", "draft"], manual: ["Entered manually", ""], saved: ["Saved consultation", ""] }[state.transcriptSource];
        $("#v2rTxBadge").innerHTML = src ? '<span class="v2r-badge ' + src[1] + '">' + src[0] + "</span>" : "";
        var stale = state.doc && state.processedTranscript !== state.transcript;
        $("#v2rTxNote").innerHTML = stale
            ? '<div class="v2r-banner warn" style="margin-top:10px">' + I("alert") + "<div>The transcript changed after the draft was generated. Press <b>Process consultation</b> to regenerate (edits made to the draft will be replaced).</div></div>" : "";
        $("#v2rRetryTx").disabled = !state.audio || state.processing;
        $("#v2rProcess").disabled = state.processing;
        $("#v2rProcess").innerHTML = state.processing ? I("loader", "spin") + "Processing\u2026" : I("zap") + "Process consultation";
    }

    // ------------------------------------------------------------------ validation panel
    function revalidate() {
        if (!state.doc) { state.issues = []; renderIssues(); return; }
        state.issues = C.validateDocument(state.doc, state.processedTranscript, patient(), { transcriptionFailed: state.stages[1].state === "error" });
        renderIssues(); markFields(); refreshApproveUI();
    }
    var scheduleValidate = debounce(revalidate, 350);

    function renderIssues() {
        var box = $("#v2rIssues");
        if (!state.doc) { box.innerHTML = '<div class="v2r-empty" style="padding:18px">' + "Validation runs after a consultation is processed.</div>"; return; }
        var order = { error: 0, warning: 1, info: 2 };
        var list = state.issues.slice().sort(function (a, b) { return order[a.severity] - order[b.severity]; });
        var n = function (s) { return list.filter(function (i) { return i.severity === s; }).length; };
        var html = '<div class="v2r-counts"><span class="v2r-pill ' + (n("error") ? "rec" : "ok") + '">' + n("error") + ' blocking</span><span class="v2r-pill ' + (n("warning") ? "warn" : "ok") + '">' + n("warning") + ' need review</span><span class="v2r-pill blue">' + n("info") + " notes</span></div>";
        html += list.map(function (i) {
            var icon = i.severity === "info" ? "info" : "alert";
            return '<div class="v2r-issue ' + i.severity + '">' + I(icon) + "<div><b>" + esc(i.title) + "</b>" + (i.detail ? '<div class="d">' + esc(i.detail) + "</div>" : "") +
                (i.source ? "<q>" + esc(i.source) + "</q>" : "") +
                (i.field ? '<button class="v2r-btn sm go" data-action="goto" data-field="' + esc(i.field) + '">Go to field</button>' : "") + "</div></div>";
        }).join("");
        html += '<div class="v2r-banner info" style="margin-top:10px">' + I("info") + "<div>No drug-interaction or allergy check is performed by this system. All items marked <i>needs review</i> must be confirmed by the clinician.</div></div>";
        box.innerHTML = html;
    }

    function markFields() {
        root.querySelectorAll("[data-fld]").forEach(function (el) {
            var id = el.getAttribute("data-fld");
            var hit = state.issues.filter(function (i) { return (i.field === id || (i.fields && i.fields.indexOf(id) !== -1)) && i.severity !== "info"; });
            var err = hit.some(function (i) { return i.severity === "error"; });
            el.classList.toggle("verify", hit.length > 0);
            el.classList.toggle("err", err);
            var flag = el.querySelector(".flag");
            if (flag) flag.textContent = err ? "Required / missing" : "Needs verification";
        });
    }

    // ------------------------------------------------------------------ output panels
    function fieldHtml(id, label, tag, value, extra) {
        var inputId = "f-" + id.replace(/[^\w]/g, "-");
        return '<div class="v2r-fld" data-fld="' + esc(id) + '"><label for="' + inputId + '"><span>' + esc(label) + '</span><span class="flag">Needs verification</span></label>' + tag(inputId, value, extra) + "</div>";
    }

    function renderOutput() {
        var has = !!state.doc;
        $("#v2rOutEmpty").hidden = has;
        ["soap", "rx", "summary"].forEach(function (t) { $("#v2rTab-" + t).disabled = !has; });
        if (has) { renderSoap(); renderRx(); renderSummary(); }
        showTab(state.tab);
        revalidate();
    }

    function showTab(t) {
        state.tab = t;
        ["soap", "rx", "summary"].forEach(function (x) {
            $("#v2rTab-" + x).setAttribute("aria-selected", String(x === t));
            $("#v2rPanel-" + x).hidden = !(state.doc && x === t);
        });
    }

    function renderSoap() {
        var d = state.doc.soap;
        var html = '<div class="v2r-notice">' + I("alert") + "<span>" + NOTICE + (isDemoData() ? " DEMO DATA." : "") + "</span></div>";
        SOAP.forEach(function (sec) {
            html += '<div class="v2r-sec"><h3><span class="l">' + sec.l + "</span>" + sec.t + "</h3>";
            sec.f.forEach(function (f) {
                html += fieldHtml(f[0] + "." + f[1], f[2], function (id, v) {
                    return '<textarea id="' + id + '" rows="' + f[3] + '" data-bind="soap" data-sec="' + f[0] + '" data-key="' + f[1] + '" placeholder="Not provided \u2014 clinician input required">' + esc(v) + "</textarea>";
                }, d[f[0]][f[1]]);
            });
            html += "</div>";
        });
        html += '<div class="v2r-actions"><button class="v2r-btn" data-action="regen">' + I("refresh") + "Regenerate from transcript</button>" +
            '<div class="v2r-row"><button class="v2r-btn" data-action="copy" data-what="soap">' + I("copy") + "Copy</button><button class=\"v2r-btn\" data-action=\"save\">" + I("save") + "Save draft</button><button class=\"v2r-btn primary\" data-action=\"print\" data-what=\"soap\">" + I("printer") + "Print / PDF</button></div></div>";
        $("#v2rPanel-soap").innerHTML = html;
    }

    function medHtml(m, n) {
        var h = '<div class="v2r-med ' + (m.verify ? "flagged" : "") + '" data-med="' + m.id + '"><div class="v2r-med-head"><b>Medicine ' + n + "</b><div class=\"v2r-row\">" +
            '<label class="v2r-check"><input type="checkbox" data-bind="med-verify" data-id="' + m.id + '"' + (m.verify ? " checked" : "") + "> Needs verification</label>" +
            '<button class="v2r-btn sm danger" data-action="med-remove" data-id="' + m.id + '" aria-label="Remove medicine ' + n + '">' + I("trash") + "Remove</button></div></div><div class=\"v2r-med-grid\">";
        MED_LABELS.forEach(function (f) {
            h += fieldHtml("med." + m.id + "." + f[0], f[1], function (id, v) {
                return '<input type="text" id="' + id + '" data-bind="med" data-id="' + m.id + '" data-key="' + f[0] + '" value="' + esc(v) + '" placeholder="Not stated">';
            }, m[f[0]]);
        });
        h += '<div class="full">' + fieldHtml("med." + m.id + ".instructions", "Additional instructions", function (id, v) {
            return '<input type="text" id="' + id + '" data-bind="med" data-id="' + m.id + '" data-key="instructions" value="' + esc(v) + '" placeholder="Optional">';
        }, m.instructions) + "</div></div>";
        if (m.sourceText) h += '<div class="v2r-src"><b>Source transcript:</b> \u201C' + esc(m.sourceText) + "\u201D</div>";
        return h + "</div>";
    }

    function renderRx() {
        var rx = state.doc.prescription, p = patient(), locked = !!rx.approved;
        var html = '<div class="v2r-notice">' + I("alert") + "<span>" + NOTICE + (isDemoData() ? " DEMO DATA \u2014 not real medical advice." : "") + "</span></div>";
        if (locked) html += '<div class="v2r-banner ok" style="margin-bottom:12px">' + I("check") + "<div><b>Approved</b> by " + esc(doctorName) + " on " + esc(new Date(rx.approvedAt).toLocaleString()) + ". Editing is locked.</div></div>";
        html += '<fieldset style="border:0;padding:0;margin:0" ' + (locked ? "disabled" : "") + '><div class="v2r-pt-grid">' +
            '<div class="v2r-fld"><label>Patient</label><input type="text" readonly value="' + esc(p ? p.name : "Not selected") + '"></div>' +
            '<div class="v2r-fld"><label>Patient ID</label><input type="text" readonly value="' + esc(p ? p.id : "") + '"></div>' +
            '<div class="v2r-fld"><label for="rxDate">Consultation date</label><input type="date" id="rxDate" data-bind="rx-date" value="' + esc(rx.date) + '"></div>' +
            '<div class="v2r-fld" data-fld="plan.followUp"><label for="rxFollow"><span>Follow-up (if stated)</span><span class="flag">Needs verification</span></label><input type="text" id="rxFollow" data-bind="rx-follow" value="' + esc(rx.followUp) + '" placeholder="Not provided"></div></div>';
        html += "<div id=\"v2rMeds\">" + (rx.meds.length ? rx.meds.map(function (m, i) { return medHtml(m, i + 1); }).join("") :
            '<div class="v2r-empty" style="padding:20px">No medicines were stated in the transcript. Nothing was added automatically.</div>') + "</div>";
        html += '<button class="v2r-btn" data-action="med-add">' + I("plus") + "Add medicine</button></fieldset>";
        html += '<div class="v2r-approve" id="v2rApprove"></div>';
        html += '<div class="v2r-actions"><span class="sub" style="margin:0;align-self:center">No interaction / allergy checking is performed.</span><div class="v2r-row"><button class="v2r-btn" data-action="copy" data-what="rx">' + I("copy") + "Copy</button><button class=\"v2r-btn\" data-action=\"save\">" + I("save") + "Save draft</button><button class=\"v2r-btn primary\" data-action=\"print\" data-what=\"rx\">" + I("printer") + "Print / PDF</button></div></div>";
        $("#v2rPanel-rx").innerHTML = html;
        refreshApproveUI(); markFields();
    }

    function blockers() {
        var b = [], rx = state.doc.prescription;
        var errs = state.issues.filter(function (i) { return i.severity === "error"; }).length;
        if (errs) b.push(errs + " blocking validation error" + (errs > 1 ? "s" : ""));
        var flagged = rx.meds.filter(function (m) { return m.verify; }).length;
        if (flagged) b.push(flagged + " medicine row" + (flagged > 1 ? "s" : "") + " still marked \u201Cneeds verification\u201D");
        if (!patient()) b.push("no patient selected");
        if (!rx.reviewed) b.push("review confirmation not ticked");
        return b;
    }

    function refreshApproveUI() {
        var box = $("#v2rApprove");
        if (!box || !state.doc) return;
        var rx = state.doc.prescription;
        if (rx.approved) { box.innerHTML = '<button class="v2r-btn" data-action="reopen">' + I("refresh") + "Reopen as draft</button>"; return; }
        var b = blockers();
        var focus = document.activeElement && document.activeElement.id;
        box.innerHTML = '<label class="v2r-check"><input type="checkbox" id="v2rReviewed" data-bind="rx-reviewed"' + (rx.reviewed ? " checked" : "") + "> I have reviewed this prescription against the transcript and I take clinical responsibility for it.</label>" +
            '<div style="margin-top:10px" class="v2r-row"><button class="v2r-btn primary" data-action="approve"' + (b.length ? " disabled" : "") + ">" + I("check") + "Approve prescription</button>" +
            (b.length ? '<span class="sub" style="margin:0">Cannot approve yet: ' + esc(b.join("; ")) + ".</span>" : "") + "</div>";
        if (focus === "v2rReviewed") $("#v2rReviewed").focus();
    }

    function renderSummary() {
        var html = '<div class="v2r-notice">' + I("alert") + "<span>" + NOTICE + (isDemoData() ? " DEMO DATA." : "") + "</span></div>";
        var problems = state.issues.filter(function (i) { return i.severity !== "info"; }).length;
        html += '<div id="v2rSumWarn"></div>';
        html += '<div class="v2r-fld"><label for="v2rSummary">Consultation summary (editable)</label><textarea id="v2rSummary" rows="12" data-bind="summary">' + esc(state.doc.summary) + "</textarea></div>";
        html += '<div class="v2r-actions"><button class="v2r-btn" data-action="regen-summary">' + I("refresh") + "Rebuild from note</button><div class=\"v2r-row\"><button class=\"v2r-btn\" data-action=\"copy\" data-what=\"summary\">" + I("copy") + "Copy</button><button class=\"v2r-btn\" data-action=\"save\">" + I("save") + "Save draft</button><button class=\"v2r-btn primary\" data-action=\"print\" data-what=\"summary\">" + I("printer") + "Print / PDF</button></div></div>";
        $("#v2rPanel-summary").innerHTML = html;
        updateSumWarn();
    }

    function updateSumWarn() {
        var el = $("#v2rSumWarn"); if (!el) return;
        var n = state.issues.filter(function (i) { return i.severity !== "info"; }).length;
        el.innerHTML = n ? '<div class="v2r-banner warn" style="margin-bottom:12px">' + I("alert") + "<div>This summary may be incomplete: " + n + " item" + (n > 1 ? "s need" : " needs") + " review (see the validation panel). Missing information is shown as \u201CNot provided\u201D.</div></div>" : "";
    }

    // ------------------------------------------------------------------ recording / upload / transcription
    async function startRec() {
        showRecError("");
        if (!Recorder.supported()) { showRecError("This browser does not support microphone recording (MediaRecorder). Upload an audio file or type a transcript."); return; }
        recorder = new Recorder({
            onTick: function (ms) { $("#v2rTime").textContent = mmss(ms); },
            onLevel: function (v) { $("#v2rLevel").style.width = Math.round(v * 100) + "%"; $("#v2rMeter").setAttribute("aria-valuenow", Math.round(v * 100)); }
        });
        try {
            await recorder.start();
            clearAudio();
            state.rec = "recording"; $("#v2rTime").textContent = "00:00";
            setStage("audio", "processing", "Recording from microphone\u2026");
        } catch (e) {
            recorder.release(); recorder = null; state.rec = "idle";
            showRecError(Recorder.explain(e));
        }
        renderRecUI();
    }

    async function stopRec(silent) {
        if (!recorder) return;
        var r = recorder; recorder = null;
        try {
            var out = await r.stop();
            state.rec = "idle";
            if (out) setAudio(out.blob, out.blob.type.indexOf("mp4") !== -1 ? ".mp4" : out.blob.type.indexOf("ogg") !== -1 ? ".ogg" : ".webm", "Recording " + new Date().toLocaleTimeString(), out.durationMs);
        } catch (e) {
            state.rec = "idle"; r.release();
            setStage("audio", "error", e.message);
            if (!silent) showRecError(e.message);
        }
        renderRecUI();
    }

    function clearAudio() {
        if (state.audio) URL.revokeObjectURL(state.audio.url);
        state.audio = null; renderAudioBox();
    }

    function setAudio(blob, ext, name, durationMs) {
        clearAudio();
        state.audio = { blob: blob, url: URL.createObjectURL(blob), ext: ext, name: name, durationMs: durationMs || 0 };
        state.stages[0].state = "pending"; refreshAudioStage();
        renderAudioBox(); renderTxMeta();
        toast("Audio ready. Press Process consultation to transcribe.", "info");
    }

    function handleUpload(file) {
        showRecError("");
        if (!file) return;
        var ext = "." + (file.name.split(".").pop() || "").toLowerCase();
        if (!file.size) { showRecError("The selected file is empty."); return; }
        if (file.size > MAX_AUDIO) { showRecError("The file is larger than 50 MB. Choose a shorter recording."); return; }
        if (AUDIO_EXT.indexOf(ext) === -1 && file.type.indexOf("audio/") !== 0) { showRecError("Unsupported file type. Use MP3, WAV, M4A, WebM, OGG, FLAC or AAC."); return; }
        if (AUDIO_EXT.indexOf(ext) === -1) ext = ".webm";
        setAudio(file, ext, file.name, 0);
    }

    async function transcribe() {
        if (!state.audio) { toast("Record or upload audio first.", "info"); return false; }
        if (!canTranscribe()) {
            state.setupNeeded = true; renderSetup();
            setStage("transcribe", "error", "Real transcription is not configured, and no transcript was invented. See setup message on the left.");
            return false;
        }
        state.setupNeeded = false; renderSetup();
        setStage("transcribe", "processing", "Transcribing locally with Whisper \u2014 this can take a while\u2026");
        try {
            var r = await Api.transcribe(state.audio.blob, state.audio.ext);
            state.transcript = r.text; state.transcriptSource = "whisper";
            $("#v2rTranscript").value = r.text;
            setStage("transcribe", "done", "Transcribed by Whisper (" + r.model + ")");
            renderTxMeta(); updateStatus();
            return true;
        } catch (e) {
            if (e.code === "WHISPER_UNAVAILABLE") { state.setupNeeded = true; renderSetup(); }
            setStage("transcribe", "error", e.message);
            return false;
        }
    }

    // ------------------------------------------------------------------ processing pipeline
    async function processConsultation() {
        if (state.processing) return;
        if (state.rec !== "idle") await stopRec();
        if (!state.transcript.trim() && state.audio) { state.processing = true; renderTxMeta(); var ok = await transcribe(); state.processing = false; renderTxMeta(); if (!ok) return; }
        if (!state.transcript.trim()) { toast("Add a transcript first: record, upload, type, or load the sample.", "err"); $("#v2rTranscript").focus(); return; }
        if (state.doc && state.dirty && !window.confirm("Regenerating will replace your edits to the draft. Continue?")) return;

        state.processing = true; renderTxMeta(); renderRecUI();
        refreshAudioStage();
        if (state.stages[1].state !== "done" || state.transcriptSource !== "whisper") {
            setStage("transcribe", state.transcriptSource === "demo-sample" ? "done" : "skipped",
                state.transcriptSource === "demo-sample" ? "Demo sample transcript (no speech recognition was run)" :
                    state.transcriptSource === "whisper" ? "Transcribed by Whisper" : "Using the transcript text as entered");
        }
        var current = "extract";
        try {
            // The sample consultation always uses the instant, deterministic rule-based path so live demos are repeatable.
            var useAI = usingServer() && !isDemoData();
            setStage("extract", "processing", useAI ? "Extracting structured data with the local model\u2026 (can take up to a minute)" : "Extracting with simple rules (no AI model)\u2026");
            await pace();
            var r = await Api.extract(state.transcript, useAI);
            var v = C.validateExtraction(r.extraction);
            if (!v.ok) throw new Error("Extraction output failed schema validation: " + v.errors.slice(0, 2).join("; "));
            state.extractionInfo = r;
            setStage("extract", "done", r.mode === "ollama" ? "Extracted with local LLM (" + r.model + ")" : "Rule-based extraction \u2014 not an AI model" + (r.notice ? ". " + r.notice : ""));

            current = "validate";
            setStage("validate", "processing", "Checking against the transcript\u2026"); await pace();
            var doc = C.docFromExtraction(v.value);
            doc.demo = isDemoData();
            state.processedTranscript = state.transcript;
            state.doc = doc; state.issues = C.validateDocument(doc, state.transcript, patient(), {});
            doc.summary = C.buildSummary(doc);
            var n = state.issues.filter(function (i) { return i.severity !== "info"; }).length;
            setStage("validate", "done", n + " item" + (n === 1 ? "" : "s") + " need review");

            current = "note";
            setStage("note", "processing", "Drafting SOAP note, prescription and summary\u2026"); await pace();
            state.dirty = true; state.tab = "soap";
            renderOutput();
            setStage("note", "done", "Draft ready \u2014 doctor review required");
            if (!patient() && v.value.patientId) {
                var match = PATIENTS.find(function (p) { return p.id.toLowerCase() === v.value.patientId.toLowerCase(); });
                if (match) { state.patientId = match.id; renderPatientSelect(); revalidate(); }
            }
            toast("Draft generated. Please review before saving or approving.");
        } catch (e) {
            setStage(current, "error", e.message || "Unexpected error");
            toast(e.message || "Processing failed", "err");
        } finally {
            state.processing = false; renderTxMeta(); renderRecUI();
        }
    }

    // ------------------------------------------------------------------ session actions
    function resetSession(patientId) {
        if (recorder) { recorder.release(); recorder = null; }
        clearAudio();
        state = freshState({ page: "workspace", patientId: patientId || "", backend: state.backend, forceDemo: state.forceDemo, histQ: state.histQ, histStatus: state.histStatus });
        $("#v2rTranscript").value = "";
        $("#v2rTime").textContent = "00:00";
        showRecError(""); renderPatientSelect(); renderSetup(); renderStages(); renderAudioBox(); renderTxMeta(); renderIssues(); renderOutput(); renderRecUI(); updateMode(); updateStatus();
    }

    function confirmDiscard() { return !state.dirty || window.confirm("You have unsaved changes. Discard them?"); }

    async function loadSample() {
        if (!confirmDiscard()) return;
        resetSession(Sample.patient.id);
        state.transcript = Sample.transcript; state.transcriptSource = "demo-sample";
        $("#v2rTranscript").value = state.transcript;
        refreshAudioStage(); renderTxMeta(); updateStatus();
        toast("Sample consultation loaded (synthetic data). Processing\u2026", "info");
        await processConsultation();
    }

    function currentText(what) {
        if (what === "soap") return C.buildSoapText(state.doc, patient());
        if (what === "rx") return C.buildRxText(state.doc, patient());
        return (isDemoData() ? "CONSULTATION SUMMARY (DEMO DATA)\n" : "CONSULTATION SUMMARY\n") + "Patient: " + (patient() ? patient().name : "Not selected") + "\n\n" + state.doc.summary + "\n\n" + NOTICE;
    }

    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) {
            try {
                var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
                document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok;
            } catch (e2) { return false; }
        }
    }

    async function save(status) {
        if (!state.doc) return false;
        if (!patient()) { toast("Select a patient before saving.", "err"); $("#v2rPatient").focus(); return false; }
        state.doc.demo = isDemoData();
        var rec = { patient: { id: patient().id, name: patient().name }, status: status || (state.doc.prescription.approved ? "approved" : "draft"), demo: isDemoData(), transcript: state.processedTranscript, transcriptSource: state.transcriptSource, doc: state.doc };
        try {
            var saved = await Api.store.save(rec, state.consultationId);
            state.consultationId = saved.id; state.dirty = false; updateStatus();
            toast(Api.reachable ? "Saved to local server." : "Saved for this browser session only (Demo storage).");
            return true;
        } catch (e) { toast("Could not save: " + e.message, "err"); return false; }
    }

    function printHtml(what) {
        var p = patient(), d = state.doc, s = d.soap, rx = d.prescription;
        function v(x) { return esc((x || "").trim() || "Not provided"); }
        var head = "<h1>" + (what === "rx" ? "Prescription" : what === "soap" ? "Consultation Note (SOAP)" : "Consultation Summary") + "</h1>" +
            "<p><b>Patient:</b> " + esc(p ? p.name + " (" + p.id + ")" : "Not selected") + "&nbsp;&nbsp; <b>Date:</b> " + esc(rx.date) + "&nbsp;&nbsp; <b>Doctor:</b> " + esc(doctorName) + "</p>";
        var wm = (isDemoData() ? '<div class="wm">DEMO DATA \u2014 NOT REAL MEDICAL ADVICE</div> ' : "") + (what === "rx" && !rx.approved || what !== "rx" ? '<div class="wm">DRAFT \u2014 NOT CLINICALLY VERIFIED</div>' : "");
        var body = "";
        if (what === "soap") {
            SOAP.forEach(function (sec) {
                body += "<h2>" + sec.l + " \u2014 " + sec.t + "</h2>";
                sec.f.forEach(function (f) { body += "<p><b>" + esc(f[2]) + ":</b> " + v(s[f[0]][f[1]]) + "</p>"; });
            });
        } else if (what === "rx") {
            body += "<h2>Medicines</h2>";
            body += rx.meds.length ? "<table><tr><th>#</th><th>Medicine</th><th>Strength</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Timing</th><th>Duration</th><th>Notes</th></tr>" +
                rx.meds.map(function (m, i) { return "<tr><td>" + (i + 1) + "</td><td>" + esc(m.name) + (m.verify ? " <b>(verify)</b>" : "") + "</td><td>" + esc(m.strength) + "</td><td>" + esc(m.dose) + "</td><td>" + esc(m.route) + "</td><td>" + esc(m.frequency) + "</td><td>" + esc(m.timing) + "</td><td>" + esc(m.duration) + "</td><td>" + esc(m.instructions) + "</td></tr>"; }).join("") + "</table>" : "<p>No medicines recorded.</p>";
            body += "<p><b>Follow-up:</b> " + v(rx.followUp) + "</p>";
            body += rx.approved ? "<p><b>Approved by:</b> " + esc(doctorName) + " on " + esc(new Date(rx.approvedAt).toLocaleString()) + "</p>" : '<p class="wm">NOT APPROVED \u2014 doctor review required</p>';
        } else {
            body += "<h2>Summary</h2><p>" + esc(d.summary) + "</p>";
        }
        return head + wm + body + '<p class="fine">' + esc(NOTICE) + " No drug-interaction or allergy check was performed by this system.</p>";
    }

    function doPrint(what) {
        var area = document.getElementById("v2rPrintArea");
        area.innerHTML = printHtml(what);
        document.body.classList.add("v2r-printing");
        var done = function () { document.body.classList.remove("v2r-printing"); area.innerHTML = ""; window.removeEventListener("afterprint", done); };
        window.addEventListener("afterprint", done);
        window.print();
    }

    // ------------------------------------------------------------------ pages: patients / history / templates / settings
    function lastVisitMap() { return Api.store.list().then(function (l) { var m = {}; l.forEach(function (c) { if (!m[c.patient.id] || m[c.patient.id] < c.updatedAt) m[c.patient.id] = c.updatedAt; }); return m; }); }

    async function renderPatientsPage() {
        var el = $("#v2rPage-patients");
        var last = await lastVisitMap().catch(function () { return {}; });
        el.innerHTML = '<section class="v2r-card"><h2>' + I("users") + " Patients</h2><p class=\"sub\">Synthetic demo patients. Starting a consultation opens the Voice2Rx workspace for that patient.</p><div class=\"v2r-scroll\"><table class=\"v2r-table\"><thead><tr><th>Name</th><th>ID</th><th>Age</th><th>Last Voice2Rx note</th><th></th></tr></thead><tbody>" +
            PATIENTS.map(function (p) {
                return "<tr><td><b>" + esc(p.name) + "</b>" + (p.note ? ' <span class="v2r-badge demo">Demo</span>' : "") + "</td><td>" + esc(p.id) + "</td><td>" + esc(p.age || "\u2014") + "</td><td>" + (last[p.id] ? esc(new Date(last[p.id]).toLocaleString()) : "\u2014") + "</td>" +
                    '<td><div class="v2r-row"><button class="v2r-btn sm primary" data-action="start-for" data-id="' + esc(p.id) + '">' + I("mic") + 'Start consultation</button><button class="v2r-btn sm" data-action="hist-for" data-id="' + esc(p.id) + '">History</button></div></td></tr>';
            }).join("") + "</tbody></table></div></section>";
    }

    async function renderHistoryPage() {
        var el = $("#v2rPage-history");
        el.innerHTML = '<section class="v2r-card"><h2>' + I("clock") + " Consultation history</h2><p class=\"sub\" id=\"v2rHistSub\"></p>" +
            '<div class="v2r-filters"><input type="search" id="v2rHistQ" data-bind="hist-q" aria-label="Search consultations" placeholder="Search patient, complaint, medicine\u2026" value="' + esc(state.histQ) + '">' +
            '<select id="v2rHistStatus" data-bind="hist-status" aria-label="Filter by status">' + [["all", "All statuses"], ["draft", "Draft"], ["approved", "Approved"]].map(function (o) { return '<option value="' + o[0] + '"' + (state.histStatus === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
            '<select id="v2rHistPatient" data-bind="hist-patient" aria-label="Filter by patient"><option value="">All patients</option>' + PATIENTS.map(function (p) { return '<option value="' + esc(p.id) + '"' + (state.histPatient === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + "</select></div>" +
            '<div id="v2rHistList" class="v2r-hist"></div></section>';
        $("#v2rHistSub").textContent = Api.reachable ? "Stored by the local Voice2Rx server (JSON file, development only)." : "Demo storage: kept only for this browser tab session. Use synthetic data only.";
        await renderHistoryList();
    }

    async function renderHistoryList() {
        var list = [];
        try { list = await Api.store.list(); } catch (e) { $("#v2rHistList").innerHTML = '<div class="v2r-banner err">' + esc(e.message) + "</div>"; return; }
        var q = state.histQ.trim().toLowerCase();
        list = list.filter(function (c) {
            if (state.histStatus !== "all" && c.status !== state.histStatus) return false;
            if (state.histPatient && c.patient.id !== state.histPatient) return false;
            if (!q) return true;
            return (c.patient.name + " " + c.patient.id + " " + JSON.stringify(c.doc.soap) + " " + c.doc.prescription.meds.map(function (m) { return m.name; }).join(" ")).toLowerCase().indexOf(q) !== -1;
        });
        $("#v2rHistList").innerHTML = list.length ? list.map(function (c) {
            var s = c.doc.soap, meds = c.doc.prescription.meds.map(function (m) { return m.name; }).filter(Boolean);
            return '<article class="item"><div class="v2r-row" style="justify-content:space-between"><b>' + esc(c.patient.name) + '</b><span class="v2r-row"><span class="v2r-badge ' + c.status + '">' + (c.status === "approved" ? "Approved" : "Draft") + "</span>" + (c.demo ? '<span class="v2r-badge demo">Demo</span>' : "") + "</span></div>" +
                '<div class="sub" style="margin:2px 0 0">' + esc(new Date(c.updatedAt).toLocaleString()) + " \u00b7 " + esc(c.patient.id) + "</div>" +
                '<div class="prev"><b>SOAP:</b> ' + esc(s.subjective.chiefComplaint || "Chief complaint not provided") + " \u2014 Assessment: " + esc(s.assessment.assessment || "not stated") + "<br><b>Rx:</b> " + (meds.length ? esc(meds.join(", ")) : "No medicines") + "</div>" +
                '<button class="v2r-btn sm primary" data-action="open" data-id="' + esc(c.id) + '">Open &amp; edit</button></article>';
        }).join("") : '<div class="v2r-empty" style="grid-column:1/-1">' + I("clock") + "No saved consultations match. Save a draft from the workspace to see it here.</div>";
    }

    function renderTemplatesPage() {
        $("#v2rPage-templates").innerHTML = '<section class="v2r-card"><h2>' + I("clip") + ' Prescription templates <span class="v2r-badge">Placeholder</span></h2><p class="sub">Not implemented in this release.</p><div class="v2r-empty">' + I("clip") + "Reusable prescription templates are planned. The prescription form in the Voice2Rx workspace is fully functional today.</div></section>";
    }

    function renderSettingsPage() {
        var b = state.backend;
        var row = function (k, v) { return "<dt>" + k + "</dt><dd>" + v + "</dd>"; };
        $("#v2rPage-settings").innerHTML = '<section class="v2r-card"><h2>' + I("cog") + " Settings &amp; local AI status</h2><p class=\"sub\">Patient data is only ever sent to the local Voice2Rx server on this machine. No external AI service is used.</p>" +
            '<dl class="v2r-kv">' +
            row("Local server", Api.reachable ? '<span class="v2r-badge approved">Connected</span>' : '<span class="v2r-badge demo">Not running</span>') +
            row("Speech-to-text", b ? (b.whisper.available ? "Whisper (" + esc(b.whisper.model) + ") ready" : "Unavailable \u2014 " + esc(b.whisper.reason || "")) : "Unavailable (server not running)") +
            row("Extraction", b ? (b.llm.available ? "Ollama model " + esc(b.llm.model) : "Rule-based fallback \u2014 " + esc(b.llm.reason || "")) : "Rule-based (Demo Mode)") +
            row("Storage", Api.reachable ? "Local JSON file (dev only)" : "Browser session (demo only)") + "</dl>" +
            '<div class="v2r-row" style="margin:16px 0"><label class="v2r-check"><input type="checkbox" id="v2rForceDemo" data-bind="force-demo"' + (state.forceDemo ? " checked" : "") + "> Force Demo Mode (ignore local AI even if available)</label><button class=\"v2r-btn sm\" data-action=\"recheck\">" + I("refresh") + "Re-check services</button></div>" +
            '<div class="v2r-banner info">' + I("info") + "<div><b>Enable real local AI</b><pre>pip install faster-whisper\nollama pull llama3.1:8b\ncp voice2rx/.env.example voice2rx/.env\nnode voice2rx/server/server.js</pre>Then open <code>http://localhost:8787/doctor-dashboard.html#patients</code>. See <code>voice2rx/README.md</code>.</div></div></section>";
    }

    // ------------------------------------------------------------------ navigation
    function showPage(p) {
        state.page = p;
        ["workspace", "patients", "history", "templates", "settings"].forEach(function (x) {
            $("#v2rPage-" + x).hidden = x !== p;
            $("#v2rNav-" + x).setAttribute("aria-selected", String(x === p));
        });
        if (p === "patients") renderPatientsPage();
        if (p === "history") renderHistoryPage();
        if (p === "templates") renderTemplatesPage();
        if (p === "settings") renderSettingsPage();
    }

    async function recheck() {
        var s = await Api.status();
        state.backend = s; updateMode();
        state.setupNeeded = false; renderSetup();
        if (state.page === "settings") renderSettingsPage();
        toast(s ? "Local server connected." : "Local server not reachable \u2014 Demo Mode.", s ? "ok" : "info");
    }

    function gotoField(field) {
        if (field === "transcript") { showPage("workspace"); $("#v2rTranscript").focus(); return; }
        if (field === "patient") { $("#v2rPatient").focus(); return; }
        showTab(field.indexOf("med.") === 0 ? "rx" : "soap");
        var wrap = root.querySelector('#v2rPanel-' + state.tab + ' [data-fld="' + field + '"]') || root.querySelector('[data-fld="' + field + '"]');
        if (wrap) { var inp = wrap.querySelector("input,textarea"); if (inp) { inp.focus(); inp.scrollIntoView({ block: "center", behavior: "smooth" }); } }
    }

    // ------------------------------------------------------------------ events
    var actions = {
        page: function (b) { showPage(b.dataset.page); },
        "rec-start": startRec,
        "rec-pause": function () { if (recorder && recorder.pause()) { state.rec = "paused"; renderRecUI(); } else toast("Pause is not supported in this browser.", "err"); },
        "rec-resume": function () { if (recorder && recorder.resume()) { state.rec = "recording"; renderRecUI(); } },
        "rec-stop": function () { stopRec(); },
        upload: function () { $("#v2rFile").click(); },
        process: processConsultation,
        "retry-transcribe": async function () {
            if (state.processing) return;
            state.processing = true; renderTxMeta();
            var ok = await transcribe();
            state.processing = false; renderTxMeta();
            if (ok) toast("Transcription complete. Review the text, then process.");
        },
        "retry-stage": function (b) {
            var k = b.dataset.stage;
            if (k === "transcribe") { actions["retry-transcribe"](); } else { state.dirty = false; processConsultation(); }
        },
        "dismiss-setup": function () { state.setupNeeded = false; renderSetup(); },
        sample: loadSample,
        "new": function () { if (confirmDiscard()) resetSession(""); },
        tab: function (b) { if (state.doc) showTab(b.dataset.tab); },
        goto: function (b) { gotoField(b.dataset.field); },
        regen: function () { state.dirty = true; processConsultation(); },
        "regen-summary": function () { state.doc.summary = C.buildSummary(state.doc); $("#v2rSummary").value = state.doc.summary; state.dirty = true; updateStatus(); toast("Summary rebuilt from the current note.", "info"); },
        copy: async function (b) { var ok = await copyText(currentText(b.dataset.what)); toast(ok ? "Copied to clipboard." : "Copy failed. Select the text manually.", ok ? "ok" : "err"); },
        save: function () { save(); },
        print: function (b) { doPrint(b.dataset.what); },
        "med-add": function () {
            state.doc.prescription.meds.push({ id: C.newId("m"), name: "", strength: "", dose: "", route: "", frequency: "", timing: "", duration: "", instructions: "", sourceText: "", source: "manual", verify: true });
            state.dirty = true; renderRx(); revalidate();
            var last = root.querySelectorAll('#v2rMeds input[data-key="name"]'); if (last.length) last[last.length - 1].focus();
        },
        "med-remove": function (b) {
            var rx = state.doc.prescription;
            rx.meds = rx.meds.filter(function (m) { return m.id !== b.dataset.id; });
            state.dirty = true; renderRx(); revalidate();
        },
        approve: async function () {
            var bl = blockers(); if (bl.length) { toast("Cannot approve: " + bl.join("; "), "err"); return; }
            var rx = state.doc.prescription; rx.approved = true; rx.approvedAt = new Date().toISOString();
            if (await save("approved")) { renderRx(); toast("Prescription approved and saved."); } else { rx.approved = false; delete rx.approvedAt; }
            updateStatus();
        },
        reopen: function () { var rx = state.doc.prescription; rx.approved = false; rx.reviewed = false; state.dirty = true; renderRx(); updateStatus(); toast("Reopened as draft. Re-review before approving.", "info"); },
        "start-for": function (b) { if (!confirmDiscard()) return; resetSession(b.dataset.id); showPage("workspace"); },
        "hist-for": function (b) { state.histPatient = b.dataset.id; showPage("history"); },
        open: async function (b) {
            if (!confirmDiscard()) return;
            var rec = await Api.store.get(b.dataset.id);
            if (!rec) { toast("Consultation not found.", "err"); return; }
            var keep = { histQ: state.histQ, histStatus: state.histStatus };
            resetSession(rec.patient.id);
            state.histQ = keep.histQ; state.histStatus = keep.histStatus;
            state.consultationId = rec.id; state.transcript = rec.transcript; state.processedTranscript = rec.transcript;
            state.transcriptSource = rec.transcriptSource === "demo-sample" ? "demo-sample" : "saved";
            state.doc = rec.doc; state.dirty = false;
            $("#v2rTranscript").value = rec.transcript;
            ["audio", "transcribe", "extract", "validate", "note"].forEach(function (k) { state.stages.find(function (s) { return s.key === k; }).state = "done"; state.stages.find(function (s) { return s.key === k; }).detail = "Loaded from saved consultation"; });
            renderStages(); renderTxMeta(); renderOutput(); updateStatus(); showPage("workspace");
            toast("Consultation opened. You can edit and save again.", "info");
        },
        recheck: recheck
    };

    function onClick(e) {
        var b = e.target.closest("[data-action]");
        if (!b || b.disabled) return;
        var fn = actions[b.dataset.action];
        if (fn) fn(b, e);
    }

    function onInput(e) {
        var t = e.target, bind = t.dataset && t.dataset.bind;
        if (!bind) return;
        if (bind === "transcript") {
            state.transcript = t.value;
            if (state.transcriptSource === "" || state.transcriptSource === "manual") state.transcriptSource = t.value.trim() ? "manual" : "";
            refreshAudioStage(); renderTxMeta(); updateStatus();
            return;
        }
        if (bind === "hist-q") { state.histQ = t.value; renderHistoryList(); return; }
        if (bind === "hist-status") { state.histStatus = t.value; renderHistoryList(); return; }
        if (bind === "hist-patient") { state.histPatient = t.value; renderHistoryList(); return; }
        if (bind === "patient") { state.patientId = t.value; if (state.doc) { state.dirty = true; renderRx(); revalidate(); } updateStatus(); return; }
        if (bind === "force-demo") { state.forceDemo = t.checked; sessionStorage.setItem("v2r_force_demo", t.checked ? "1" : ""); updateMode(); renderSettingsPage(); return; }
        if (!state.doc) return;
        var rx = state.doc.prescription;
        if (bind === "soap") state.doc.soap[t.dataset.sec][t.dataset.key] = t.value;
        else if (bind === "summary") state.doc.summary = t.value;
        else if (bind === "rx-date") rx.date = t.value;
        else if (bind === "rx-follow") { rx.followUp = t.value; state.doc.soap.plan.followUp = t.value; var f = root.querySelector("#f-plan-followUp"); if (f) f.value = t.value; }
        else if (bind === "rx-reviewed") { rx.reviewed = t.checked; refreshApproveUI(); updateStatus(); return; }
        else if (bind === "med-verify") {
            var mv = rx.meds.find(function (m) { return m.id === t.dataset.id; }); mv.verify = t.checked;
            t.closest(".v2r-med").classList.toggle("flagged", t.checked);
        } else if (bind === "med") {
            var m = rx.meds.find(function (x) { return x.id === t.dataset.id; });
            m[t.dataset.key] = t.value; m.source = "manual";
        }
        if (bind === "soap" && t.dataset.key === "followUp") { rx.followUp = t.value; var rf = root.querySelector("#rxFollow"); if (rf) rf.value = t.value; }
        state.dirty = true; updateStatus(); scheduleValidate();
        if (bind === "summary") return;
    }

    // ------------------------------------------------------------------ init / view switching
    function showView(v) {
        var dash = document.getElementById("viewDashboard"), pat = document.getElementById("viewPatients");
        var isPat = v === "patients";
        dash.hidden = isPat; pat.hidden = !isPat;
        document.querySelectorAll("[data-view]").forEach(function (a) { a.classList.toggle("active", a.dataset.view === v); });
        if (!isPat && recorder) stopRec(true); // never keep the microphone open in a hidden view
    }

    function init() {
        buildShell();
        var pa = document.createElement("div"); pa.id = "v2rPrintArea"; document.body.appendChild(pa);
        state = freshState({ forceDemo: sessionStorage.getItem("v2r_force_demo") === "1" });
        root.addEventListener("click", onClick);
        root.addEventListener("input", onInput);
        root.addEventListener("change", onInput);
        $("#v2rFile").addEventListener("change", function (e) { handleUpload(e.target.files[0]); e.target.value = ""; });
        window.addEventListener("pagehide", function () { if (recorder) recorder.release(); });
        window.addEventListener("beforeunload", function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

        renderPatientSelect(); renderStages(); renderRecUI(); renderTxMeta(); renderIssues(); renderOutput(); updateMode(); showPage("workspace");

        document.querySelectorAll("[data-view]").forEach(function (a) {
            a.addEventListener("click", function (e) { e.preventDefault(); location.hash = a.dataset.view === "patients" ? "patients" : ""; showView(a.dataset.view); });
        });
        window.addEventListener("hashchange", function () { showView(location.hash === "#patients" ? "patients" : "dashboard"); });
        showView(location.hash === "#patients" ? "patients" : "dashboard");

        Api.status().then(function (s) { state.backend = s; updateMode(); renderRecUI(); });
    }

    // Expose a tiny surface for automated checks.
    window.V2RApp = { get state() { return state; }, actions: actions, processConsultation: processConsultation };
    init();
})();
