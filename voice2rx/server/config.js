"use strict";
// Minimal .env loader (no dependencies) + typed config. Never commit voice2rx/.env.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

(function loadEnv() {
    const file = path.join(ROOT, ".env");
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
})();

module.exports = {
    ROOT,
    REPO_ROOT: path.resolve(ROOT, ".."),
    port: Number(process.env.PORT || 8787),
    maxAudioBytes: Number(process.env.MAX_AUDIO_MB || 50) * 1024 * 1024,
    dataFile: path.resolve(ROOT, process.env.DATA_FILE || "server/data/consultations.json"),
    whisper: {
        python: process.env.WHISPER_PYTHON || "python3",
        model: process.env.WHISPER_MODEL || "base",
        language: process.env.WHISPER_LANGUAGE || "",
        timeoutMs: Number(process.env.WHISPER_TIMEOUT_SEC || 600) * 1000,
    },
    llm: {
        provider: (process.env.LLM_PROVIDER || "ollama").toLowerCase(), // "ollama" | "basic"
        url: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
        model: process.env.OLLAMA_MODEL || "llama3.1:8b",
        timeoutMs: Number(process.env.OLLAMA_TIMEOUT_SEC || 180) * 1000,
    },
};
