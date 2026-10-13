"use strict";
// Consultation persistence: JSON file for local development.
// LIMITATION: not encrypted, no auth, single process. Use a real DB + auth in production.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");

let queue = Promise.resolve(); // serialise writes

async function readAll() {
    try {
        return JSON.parse(await fs.promises.readFile(config.dataFile, "utf8"));
    } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
    }
}

function writeAll(list) {
    queue = queue.then(async () => {
        await fs.promises.mkdir(path.dirname(config.dataFile), { recursive: true });
        const tmp = config.dataFile + ".tmp";
        await fs.promises.writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
        await fs.promises.rename(tmp, config.dataFile);
    });
    return queue;
}

async function list() {
    return (await readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function get(id) {
    return (await readAll()).find((c) => c.id === id) || null;
}

async function save(input, id) {
    const all = await readAll();
    const now = new Date().toISOString();
    const rec = {
        id: id || crypto.randomUUID(),
        patient: { id: String(input.patient.id), name: String(input.patient.name || "") },
        status: input.status,
        demo: !!input.demo,
        transcript: input.transcript,
        transcriptSource: String(input.transcriptSource || ""),
        doc: input.doc,
        createdAt: now,
        updatedAt: now,
    };
    const idx = id ? all.findIndex((c) => c.id === id) : -1;
    if (id && idx === -1) return null;
    if (idx >= 0) { rec.createdAt = all[idx].createdAt; all[idx] = rec; } else all.push(rec);
    await writeAll(all);
    return rec;
}

module.exports = { list, get, save };
