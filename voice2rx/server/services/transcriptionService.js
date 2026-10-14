"use strict";
// Speech-to-text via local open-source Whisper (faster-whisper) run as a Python subprocess.
// Audio is written to a temp file, transcribed, then deleted. Transcripts are never logged.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const config = require("../config");

const SCRIPT = path.resolve(config.ROOT, "whisper_service", "transcribe.py");
const ALLOWED_EXT = [".webm", ".ogg", ".mp3", ".wav", ".m4a", ".mp4", ".flac", ".aac", ".opus", ".aiff", ".aif"];

let cache = { at: 0, value: null };

function status() {
    const now = Date.now();
    if (cache.value && now - cache.at < 30000) return Promise.resolve(cache.value);
    return new Promise((resolve) => {
        execFile(config.whisper.python, [SCRIPT, "--check"], { timeout: 30000 }, (err) => {
            cache = {
                at: Date.now(),
                value: err
                    ? { available: false, model: config.whisper.model, reason: "faster-whisper is not installed for '" + config.whisper.python + "'" }
                    : { available: true, model: config.whisper.model },
            };
            resolve(cache.value);
        });
    });
}

async function transcribe(buffer, ext) {
    ext = (ext || ".webm").toLowerCase();
    if (!ext.startsWith(".")) ext = "." + ext;
    if (!ALLOWED_EXT.includes(ext)) throw Object.assign(new Error("Unsupported audio format: " + ext), { status: 415 });
    if (!buffer || buffer.length < 1000) throw Object.assign(new Error("Audio is empty or too short"), { status: 400 });
    const st = await status();
    if (!st.available) throw Object.assign(new Error("Whisper is not configured: " + st.reason), { status: 503, code: "WHISPER_UNAVAILABLE" });

    const tmp = path.join(os.tmpdir(), "v2r-" + process.pid + "-" + Date.now() + ext);
    await fs.promises.writeFile(tmp, buffer, { mode: 0o600 });
    try {
        const args = [SCRIPT, tmp, "--model", config.whisper.model];
        if (config.whisper.language) args.push("--language", config.whisper.language);
        const out = await new Promise((resolve, reject) => {
            execFile(config.whisper.python, args, { timeout: config.whisper.timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
                if (err) return reject(Object.assign(new Error("Transcription process failed"), { status: 500 }));
                resolve(stdout);
            });
        });
        const parsed = JSON.parse(out);
        if (!parsed.text || !parsed.text.trim()) throw Object.assign(new Error("No speech detected in the audio"), { status: 422 });
        return { text: parsed.text.trim(), language: parsed.language || "", model: config.whisper.model };
    } finally {
        fs.promises.unlink(tmp).catch(() => { });
    }
}

module.exports = { status, transcribe, ALLOWED_EXT };
