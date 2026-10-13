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

const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
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
    if (o && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) {
        res.setHeader("Access-Control-Allow-Origin", o);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Audio-Ext");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    }
}

async function api(req, res, url) {
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/status") {
        const [stt, llm] = await Promise.all([transcription.status(), extraction.status()]);
        return send(res, 200, { ok: true, whisper: stt, llm, persistence: "json-file" });
    }
    if (req.method === "POST" && p === "/api/transcribe") {
        const audio = await readBody(req, config.maxAudioBytes);
        const ext = String(req.headers["x-audio-ext"] || "").toLowerCase();
        return send(res, 200, await transcription.transcribe(audio, ext));
    }
    if (req.method === "POST" && p === "/api/extract") {
        const body = await readJson(req);
        const err = validation.validateTranscriptInput(body);
        if (err) return send(res, 400, { error: err });
        return send(res, 200, await extraction.extract(body.transcript));
    }
    if (p === "/api/consultations" && req.method === "GET") return send(res, 200, await consultations.list());
    if (p === "/api/consultations" && req.method === "POST") {
        const body = await readJson(req);
        const err = validation.validateConsultationInput(body);
        if (err) return send(res, 400, { error: err });
        return send(res, 201, await consultations.save(body));
    }
    const m = p.match(/^\/api\/consultations\/([\w-]+)$/);
    if (m && req.method === "GET") {
        const rec = await consultations.get(m[1]);
        return rec ? send(res, 200, rec) : send(res, 404, { error: "Not found" });
    }
    if (m && req.method === "PUT") {
        const body = await readJson(req);
        const err = validation.validateConsultationInput(body);
        if (err) return send(res, 400, { error: err });
        const rec = await consultations.save(body, m[1]);
        return rec ? send(res, 200, rec) : send(res, 404, { error: "Not found" });
    }
    return send(res, 404, { error: "Unknown endpoint" });
}

function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(config.REPO_ROOT, rel));
    const blocked = /(^|[\\/])(\.|node_modules|server[\\/]data|whisper_service)/.test(path.relative(config.REPO_ROOT, file)) ||
        /\.env/.test(file) || (/voice2rx[\\/]server/.test(file));
    if (!file.startsWith(config.REPO_ROOT + path.sep) || blocked || !MIME[path.extname(file)]) { res.writeHead(404); return res.end("Not found"); }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)], "Cache-Control": "no-cache" });
        res.end(data);
    });
}

const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, "http://localhost");
    try {
        if (url.pathname.startsWith("/api/")) await api(req, res, url);
        else serveStatic(req, res, url);
    } catch (e) {
        if (res.headersSent) return res.end();
        send(res, e.status || 500, { error: e.status ? e.message : "Internal server error", code: e.code || undefined });
    }
});

server.listen(config.port, "127.0.0.1", () => {
    console.log("Voice2Rx server running: http://localhost:" + config.port + "/doctor-dashboard.html");
});
