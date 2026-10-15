"use strict";
// Voice2Rx local API + static file server (zero dependencies, Node 18+).
//   node voice2rx/server/server.js   ->  http://localhost:8787/doctor-dashboard.html
// Request bodies / transcripts are NEVER logged.
const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const transcription = require("./services/transcriptionService");
const extraction = require("./services/clinicalExtractionService");
const validation = require("./services/validationService");
const consultations = require("./services/consultationService");
const patientDocuments = require("./services/patientDocumentService");
const labReports = require("./services/labReportService");

const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
    ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain; charset=utf-8"
};

function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error("Payload too large"), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function readJson(req) {
    const buf = await readBody(req, 5 * 1024 * 1024);
    try { return JSON.parse(buf.toString("utf8") || "{}"); } catch (e) { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

function cors(req, res) {
    const o = req.headers.origin;
    if (o) {
        res.setHeader("Access-Control-Allow-Origin", o);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Audio-Ext, Authorization, X-Requested-With");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "X-Highlight-Count, Content-Disposition");
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Audio-Ext, Authorization, X-Requested-With");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "X-Highlight-Count, Content-Disposition");
    }
}

function parseMultipart(buffer, boundary) {
    const parts = [];
    const bBuf = Buffer.from("--" + boundary);
    let start = 0;
    while ((start = buffer.indexOf(bBuf, start)) !== -1) {
        start += bBuf.length;
        if (buffer[start] === 0x2D && buffer[start + 1] === 0x2D) break; // end "--"
        if (buffer[start] === 0x0D && buffer[start + 1] === 0x0A) start += 2; // \r\n
        const next = buffer.indexOf(bBuf, start);
        if (next === -1) break;
        const partBuf = buffer.slice(start, next - 2);
        const headerEnd = partBuf.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
            const headerStr = partBuf.slice(0, headerEnd).toString("utf8");
            const body = partBuf.slice(headerEnd + 4);
            const fnMatch = headerStr.match(/filename="([^"]+)"/);
            if (fnMatch) {
                parts.push({ filename: fnMatch[1], data: body });
            }
        }
        start = next;
    }
    return parts;
}

async function api(req, res, url) {
    const p = url.pathname;
    const method = req.method;

    // --- Status & Extraction ---
    if (method === "GET" && p === "/api/status") {
        const [stt, llm] = await Promise.all([transcription.status(), extraction.status()]);
        return send(res, 200, { ok: true, whisper: stt, llm, persistence: "json-file" });
    }
    if (method === "POST" && p === "/api/transcribe") {
        const audio = await readBody(req, config.maxAudioBytes);
        const ext = String(req.headers["x-audio-ext"] || "").toLowerCase();
        return send(res, 200, await transcription.transcribe(audio, ext));
    }
    if (method === "POST" && p === "/api/extract") {
        const body = await readJson(req);
        const err = validation.validateTranscriptInput(body);
        if (err) return send(res, 400, { error: err });
        return send(res, 200, await extraction.extract(body.transcript));
    }

    // --- Consultations ---
    if (p === "/api/consultations" && method === "GET") return send(res, 200, await consultations.list());
    if (p === "/api/consultations" && method === "POST") {
        const body = await readJson(req);
        const err = validation.validateConsultationInput(body);
        if (err) return send(res, 400, { error: err });
        return send(res, 201, await consultations.save(body));
    }
    const mConsult = p.match(/^\/api\/consultations\/([\w-]+)$/);
    if (mConsult && method === "GET") {
        const rec = await consultations.get(mConsult[1]);
        return rec ? send(res, 200, rec) : send(res, 404, { error: "Not found" });
    }
    if (mConsult && method === "PUT") {
        const body = await readJson(req);
        const err = validation.validateConsultationInput(body);
        if (err) return send(res, 400, { error: err });
        const rec = await consultations.save(body, mConsult[1]);
        return rec ? send(res, 200, rec) : send(res, 404, { error: "Not found" });
    }

    // --- System Endpoints (ClinicOS) ---
    if (p === "/api/system/status" && method === "GET") {
        return send(res, 200, patientDocuments.systemStatus());
    }
    if (p === "/api/system/seed-demo" && method === "POST") {
        return send(res, 200, patientDocuments.seedDemoData());
    }

    // --- Patients (ClinicOS) ---
    if (p === "/api/patients" && method === "GET") {
        return send(res, 200, patientDocuments.listPatients());
    }
    if (p === "/api/patients" && method === "POST") {
        const body = await readJson(req);
        try {
            const created = patientDocuments.createPatient(body);
            return send(res, 201, created);
        } catch (e) {
            return send(res, e.status || 400, { detail: e.message });
        }
    }

    // Specific patient search: /api/patients/:id/search
    const mSearch = p.match(/^\/api\/patients\/([^/]+)\/search$/);
    if (mSearch && method === "GET") {
        const patientId = mSearch[1];
        const q = url.searchParams.get("q") || "";
        const mode = url.searchParams.get("mode") || "exact";
        const page = parseInt(url.searchParams.get("page") || "1", 10);
        const pageSize = parseInt(url.searchParams.get("page_size") || "20", 10);
        try {
            const searchResult = patientDocuments.searchPatientDocuments(patientId, q, mode, page, pageSize);
            return send(res, 200, searchResult);
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }

    // Patient documents list / upload: /api/patients/:id/documents
    const mDocs = p.match(/^\/api\/patients\/([^/]+)\/documents$/);
    if (mDocs && method === "GET") {
        const patientId = mDocs[1];
        try {
            return send(res, 200, patientDocuments.listPatientDocuments(patientId));
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }
    if (mDocs && method === "POST") {
        const patientId = mDocs[1];
        const contentType = req.headers["content-type"] || "";
        const rawBuf = await readBody(req, 30 * 1024 * 1024);
        const uploadedDocs = [];

        if (contentType.includes("multipart/form-data")) {
            const bMatch = contentType.match(/boundary=(?:["']?([^"';]+)["']?)/i);
            if (bMatch) {
                const parts = parseMultipart(rawBuf, bMatch[1]);
                for (const part of parts) {
                    uploadedDocs.push(patientDocuments.uploadDocument(patientId, part.filename, part.data));
                }
            }
        } else {
            const fn = req.headers["x-filename"] || "uploaded_medical_report.txt";
            uploadedDocs.push(patientDocuments.uploadDocument(patientId, fn, rawBuf));
        }

        return send(res, 200, uploadedDocs);
    }

    // --- Laboratory Reports Endpoints ---
    // Catalog of known standard lab tests
    if (p === "/api/lab-reports/catalog" && method === "GET") {
        const list = Object.entries(labReports.LAB_CATALOG).map(([name, meta]) => ({
            key: meta.aliases[0] || name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
            name,
            category: meta.category,
            unit: meta.unit,
            min: meta.min,
            max: meta.max,
            femaleMin: meta.femaleMin,
            femaleMax: meta.femaleMax,
            aliases: meta.aliases
        }));
        return send(res, 200, list);
    }

    // Parse raw text or preview lab tests
    if (p === "/api/lab-reports/parse" && method === "POST") {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8") || "{}");
        const raw = body.rawText || body.text || "";
        const parsed = labReports.parseLabText(raw);
        return send(res, 200, parsed);
    }

    // Multi-report comparison for a patient: POST /api/patients/:id/lab-reports/compare
    const mLabCompare = p.match(/^\/api\/patients\/([^/]+)\/lab-reports\/compare$/);
    if (mLabCompare && method === "POST") {
        const patientId = mLabCompare[1];
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString("utf8") || "{}");
        const comparison = labReports.compareReports(patientId, body.reportIds || "all");
        return send(res, 200, comparison);
    }

    // Patient lab reports: GET & POST /api/patients/:id/lab-reports
    const mLabReports = p.match(/^\/api\/patients\/([^/]+)\/lab-reports$/);
    if (mLabReports && method === "GET") {
        const patientId = mLabReports[1];
        const reports = labReports.getPatientReports(patientId);
        return send(res, 200, reports);
    }
    if (mLabReports && method === "POST") {
        const patientId = mLabReports[1];
        const contentType = req.headers["content-type"] || "";
        let payload = {};

        if (contentType.includes("application/json")) {
            payload = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString("utf8") || "{}");
        } else if (contentType.includes("multipart/form-data")) {
            const rawBuf = await readBody(req, 15 * 1024 * 1024);
            const bMatch = contentType.match(/boundary=(?:["']?([^"';]+)["']?)/i);
            if (bMatch) {
                const parts = parseMultipart(rawBuf, bMatch[1]);
                const filePart = parts.find((pt) => pt.filename);
                if (filePart) {
                    payload.filename = filePart.filename;
                    payload.rawText = filePart.data.toString("utf8");
                    payload.title = filePart.filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
                }
            }
        } else {
            const rawBuf = await readBody(req, 5 * 1024 * 1024);
            payload.rawText = rawBuf.toString("utf8");
            payload.title = req.headers["x-filename"] || "Uploaded Lab Report";
        }

        const newReport = labReports.uploadLabReport(patientId, payload);
        // Also auto-generate comparison if multiple reports exist
        const comparison = labReports.compareReports(patientId, "all");
        return send(res, 201, {
            ...newReport,
            report: newReport,
            comparison
        });
    }

    // Delete single lab report: DELETE /api/patients/:id/lab-reports/:reportId
    const mLabDelete = p.match(/^\/api\/patients\/([^/]+)\/lab-reports\/([^/]+)$/);
    if (mLabDelete && method === "DELETE") {
        const reportId = mLabDelete[2];
        const ok = labReports.deleteReport(reportId);
        if (!ok) return send(res, 404, { detail: "Lab report not found." });
        res.writeHead(204);
        return res.end();
    }

    // Single patient details / delete: /api/patients/:id
    const mPat = p.match(/^\/api\/patients\/([^/]+)$/);
    if (mPat && method === "GET") {
        const pat = patientDocuments.getPatient(mPat[1]);
        if (!pat) return send(res, 404, { detail: `Patient with ID ${mPat[1]} does not exist.` });
        return send(res, 200, pat);
    }
    if (mPat && method === "DELETE") {
        try {
            patientDocuments.deletePatient(mPat[1]);
            res.writeHead(204);
            return res.end();
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }

    // --- Document Endpoints (ClinicOS) ---
    const mDocContent = p.match(/^\/api\/documents\/(\d+)\/content$/);
    if (mDocContent && method === "GET") {
        const docId = mDocContent[1];
        const highlightTerm = url.searchParams.get("highlight");
        const download = url.searchParams.get("download") === "true";
        const docRes = patientDocuments.findDocument(docId);
        if (!docRes) return send(res, 404, { detail: `Document with ID ${docId} not found.` });

        const { doc } = docRes;
        const filePath = patientDocuments.resolveDocumentFilePath(doc);
        const disposition = download ? "attachment" : "inline";

        if (filePath && fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = MIME[ext] || "application/octet-stream";
            res.writeHead(200, {
                "Content-Type": mimeType,
                "Content-Disposition": `${disposition}; filename="${doc.original_filename}"`,
                "X-Highlight-Count": highlightTerm ? "1" : "0"
            });
            return fs.createReadStream(filePath).pipe(res);
        } else {
            // Text representation fallback
            const fullText = (doc.segments || []).map(s => `[Page ${s.page_number}]\n${s.content}`).join("\n\n");
            res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `${disposition}; filename="${doc.original_filename}.txt"`,
                "X-Highlight-Count": highlightTerm ? "1" : "0"
            });
            return res.end(fullText);
        }
    }

    const mDocSegs = p.match(/^\/api\/documents\/(\d+)\/segments$/);
    if (mDocSegs && method === "GET") {
        try {
            return send(res, 200, patientDocuments.getDocumentSegments(mDocSegs[1]));
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }

    const mDocLocs = p.match(/^\/api\/documents\/(\d+)\/search-locations$/);
    if (mDocLocs && method === "GET") {
        const query = url.searchParams.get("q") || "";
        return send(res, 200, patientDocuments.getDocumentSearchLocations(mDocLocs[1], query));
    }

    const mDocReprocess = p.match(/^\/api\/documents\/(\d+)\/reprocess$/);
    if (mDocReprocess && method === "POST") {
        try {
            return send(res, 200, patientDocuments.reprocessDocument(mDocReprocess[1]));
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }

    const mDocMeta = p.match(/^\/api\/documents\/(\d+)$/);
    if (mDocMeta && method === "GET") {
        try {
            return send(res, 200, patientDocuments.getDocument(mDocMeta[1]));
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }
    if (mDocMeta && method === "DELETE") {
        try {
            patientDocuments.deleteDocument(mDocMeta[1]);
            res.writeHead(204);
            return res.end();
        } catch (e) {
            return send(res, e.status || 404, { detail: e.message });
        }
    }

    return send(res, 404, { error: "Unknown endpoint" });
}

function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/doctor-dashboard.html";

    // Handle ClinicOS frontend dist static bundle if requested
    if (rel === "/patient-history" || rel === "/patient-history/") {
        rel = "/ClinicOS_patient_history/frontend/dist/index.html";
    } else if (rel.startsWith("/assets/")) {
        const distAsset = path.join(config.REPO_ROOT, "ClinicOS_patient_history/frontend/dist", rel);
        if (fs.existsSync(distAsset)) {
            const ext = path.extname(distAsset).toLowerCase();
            res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
            return fs.createReadStream(distAsset).pipe(res);
        }
    }

    const file = path.normalize(path.join(config.REPO_ROOT, rel));
    const blocked = /(^|[\\/])(\.|node_modules|server[\\/]data|whisper_service)/.test(path.relative(config.REPO_ROOT, file)) ||
        /\.env/.test(file) || (/voice2rx[\\/]server/.test(file));
    if (!file.startsWith(config.REPO_ROOT + path.sep) || blocked) {
        res.writeHead(404);
        return res.end("Not found");
    }

    const ext = path.extname(file).toLowerCase();
    const contentType = MIME[ext] || "text/plain; charset=utf-8";

    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(data);
    });
}

function handleRequest(req, res) {
    cors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
        api(req, res, url).catch((e) => {
            if (res.headersSent) return res.end();
            send(res, e.status || 500, { detail: e.message || "Internal server error" });
        });
    } else {
        serveStatic(req, res, url);
    }
}

const server = http.createServer(handleRequest);

server.listen(config.port, "127.0.0.1", () => {
    console.log("Voice2Rx server running: http://localhost:" + config.port + "/doctor-dashboard.html");
});

// Also bind port 8000 if available so standalone scripts & verify tests connect transparently
try {
    const secondaryServer = http.createServer(handleRequest);
    secondaryServer.listen(8000, "127.0.0.1", () => {
        console.log("ClinicOS API compatibility bridge running: http://127.0.0.1:8000/api");
    });
    secondaryServer.on("error", (e) => {
        console.log("Port 8000 bridge not bound (port in use or restricted):", e.message);
    });
} catch (e) {
    // Port 8000 optional
}
