"use strict";
// Dependency-free tests: node voice2rx/tests/run.js   (server must be running on :8787 for the API section)
const assert = require("assert");
const C = require("../shared/clinical");

let failed = 0;
function t(name, fn) { return Promise.resolve().then(fn).then(() => console.log("  ok  " + name), (e) => { failed++; console.log("FAIL  " + name + "\n      " + e.message); }); }

const SAMPLE = [
    "This is a demonstration consultation using synthetic data only.", "Patient Demo Patient 001.", "Complaint of fever and headache for two days.",
    "Examination not provided.", "Assessment is awaiting clinician assessment.", "Plan is awaiting clinician input.",
    "Medication mentioned: paracetamol, strength and frequency not stated.",
].join("\n");

(async () => {
    console.log("Shared clinical logic");
    await t("sample: extracts only what was said", () => {
        const e = C.basicExtract(SAMPLE);
        assert.strictEqual(e.patientId, "Demo Patient 001");
        assert.strictEqual(e.chiefComplaint, "fever and headache");
        assert.strictEqual(e.symptomDuration, "two days");
        assert.strictEqual(e.examination, "");
        assert.strictEqual(e.assessment, "");
        assert.strictEqual(e.plan, "");
        assert.strictEqual(e.medications.length, 1);
        const m = e.medications[0];
        assert.strictEqual(m.name, "paracetamol");
        ["strength", "dose", "frequency", "duration", "route"].forEach((k) => assert.strictEqual(m[k], "", k + " must not be invented"));
    });
    await t("explicit medication details are captured verbatim", () => {
        const e = C.basicExtract("Complaint of cough for five days. Prescribe amoxicillin 500 mg twice daily after food for five days.");
        const m = e.medications[0];
        assert.strictEqual(m.name, "amoxicillin"); assert.strictEqual(m.strength, "500 mg");
        assert.strictEqual(m.frequency, "twice daily"); assert.strictEqual(m.timing, "after food"); assert.strictEqual(m.duration, "five days");
        assert.strictEqual(e.symptomDuration, "five days");
    });
    await t("several drugs in one sentence: no value guessing", () => {
        const m = C.basicExtract("Prescribe paracetamol and ibuprofen 400 mg twice daily.").medications;
        assert.strictEqual(m.length, 2);
        m.forEach((x) => assert.strictEqual(x.strength + x.frequency, ""));
    });
    await t("vitals only when stated", () => {
        assert.strictEqual(C.basicExtract(SAMPLE).vitals.temperature, "");
        const v = C.basicExtract("On examination blood pressure 120 over 80, pulse 72.").vitals;
        assert.strictEqual(v.bloodPressure, "120/80"); assert.strictEqual(v.pulse, "72");
    });
    await t("validation flags sample issues", () => {
        const d = C.docFromExtraction(C.basicExtract(SAMPLE));
        const ids = C.validateDocument(d, SAMPLE, { id: "Demo Patient 001", name: "Demo Patient 001" }).map((i) => i.id);
        assert(ids.includes("assess-missing")); assert(ids.includes("plan-missing"));
        assert(ids.some((i) => i.startsWith("med-missing-")));
        assert(!ids.includes("cc-missing"));
    });
    await t("validation catches hallucinated medicine & patient mismatch", () => {
        const d = C.docFromExtraction(C.basicExtract(SAMPLE));
        d.prescription.meds[0].name = "warfarin";
        const ids = C.validateDocument(d, SAMPLE, { id: "PT-1001", name: "Rahul Sharma" }).map((i) => i.id);
        assert(ids.some((i) => i.startsWith("med-ground-")));
        assert(ids.includes("pt-mismatch"));
    });
    await t("schema validation rejects wrong types", () => {
        assert.strictEqual(C.validateExtraction({ chiefComplaint: 5 }).ok, false);
        assert.strictEqual(C.validateExtraction({ medications: [{ name: "" }] }).ok, false);
        assert.strictEqual(C.validateExtraction("x").ok, false);
        assert.strictEqual(C.validateExtraction({ chiefComplaint: "x", medications: [{ name: "a", strength: 5 }] }).value.medications[0].strength, "5");
    });
    await t("empty transcript is an error", () => {
        const ids = C.validateDocument(C.docFromExtraction(C.basicExtract("")), "", null).map((i) => i.id);
        assert(ids.includes("tx-empty")); assert(ids.includes("cc-missing"));
    });

    console.log("Local API (http://localhost:8787)");
    const base = "http://localhost:8787";
    let up = true;
    try { await fetch(base + "/api/status"); } catch (e) { up = false; console.log("  skip  server not running"); }
    if (up) {
        await t("status", async () => { const s = await (await fetch(base + "/api/status")).json(); assert(s.ok && s.whisper && s.llm); });
        await t("extract validates input", async () => { assert.strictEqual((await fetch(base + "/api/extract", { method: "POST", body: "{}" })).status, 400); });
        await t("extract returns rule-based/LLM result", async () => {
            const r = await (await fetch(base + "/api/extract", { method: "POST", body: JSON.stringify({ transcript: SAMPLE }) })).json();
            assert(["basic", "ollama"].includes(r.mode)); assert(C.validateExtraction(r.extraction).ok);
        });
        await t("transcribe rejects empty audio / bad format", async () => {
            assert.strictEqual((await fetch(base + "/api/transcribe", { method: "POST", headers: { "X-Audio-Ext": ".exe" }, body: Buffer.alloc(2000) })).status, 415);
            assert([400, 503].includes((await fetch(base + "/api/transcribe", { method: "POST", headers: { "X-Audio-Ext": ".wav" }, body: Buffer.alloc(10) })).status));
        });
        await t("consultation save / get / update / list; approval rules", async () => {
            const doc = C.docFromExtraction(C.basicExtract(SAMPLE));
            const body = { patient: { id: "TEST-API", name: "Test" }, status: "draft", demo: true, transcript: SAMPLE, transcriptSource: "demo-sample", doc };
            const post = await fetch(base + "/api/consultations", { method: "POST", body: JSON.stringify(body) });
            assert.strictEqual(post.status, 201);
            const rec = await post.json();
            assert.strictEqual((await (await fetch(base + "/api/consultations/" + rec.id)).json()).patient.id, "TEST-API");
            const bad = await fetch(base + "/api/consultations/" + rec.id, { method: "PUT", body: JSON.stringify({ ...body, status: "approved", doc: { ...doc, soap: { ...doc.soap, subjective: { ...doc.soap.subjective, chiefComplaint: "" } } } }) });
            assert.strictEqual(bad.status, 400);
            assert.strictEqual((await fetch(base + "/api/consultations/nope")).status, 404);
            assert((await (await fetch(base + "/api/consultations")).json()).some((c) => c.id === rec.id));
        });
        await t("static server blocks server code and path traversal", async () => {
            assert.strictEqual((await fetch(base + "/voice2rx/server/config.js")).status, 404);
            assert.strictEqual((await fetch(base + "/voice2rx/.env.example")).status, 404);
            assert.strictEqual((await fetch(base + "/doctor-dashboard.html")).status, 200);
        });
    }
    console.log(failed ? "\n" + failed + " FAILED" : "\nAll tests passed");
    process.exit(failed ? 1 : 0);
})();
