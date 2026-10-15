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
    await t("SOAP structured transcript extracts all sections reliably", () => {
        const text = [
            "Patient: PT-1002.",
            "S: Patient reports throbbing pain in right ear for 3 days.",
            "O: Otoscopy shows erythematous tympanic membrane. Temp 100.2 F, BP 120/80.",
            "A: Acute Otitis Media right ear.",
            "P: Prescribe Amoxicillin 500 mg twice daily for 7 days. Review in 5 days."
        ].join("\n");
        const ex = C.basicExtract(text);
        assert.strictEqual(ex.patientId, "PT-1002");
        assert(ex.chiefComplaint.includes("throbbing pain in right ear"));
        assert(ex.examination.includes("Otoscopy shows"));
        assert(ex.assessment.includes("Acute Otitis Media"));
        assert(ex.vitals.temperature.includes("100.2"));
        assert(ex.vitals.bloodPressure, "120/80");
        assert(ex.followUp.includes("Review in 5 days"));
        assert.strictEqual(ex.medications.length, 1);
        assert.strictEqual(ex.medications[0].name, "Amoxicillin");
        const doc = C.docFromExtraction(ex);
        const soapText = C.buildSoapText(doc, { id: "PT-1002", name: "Priya Kumar" });
        assert(soapText.includes("S - SUBJECTIVE"));
        assert(soapText.includes("O - OBJECTIVE"));
        assert(soapText.includes("A - ASSESSMENT"));
        assert(soapText.includes("P - PLAN"));
    });
    await t("emptyDoc generates a safe, blank editable SOAP note", () => {
        const blank = C.emptyDoc({ id: "PT-1001", name: "Rahul Sharma" });
        assert(blank.soap && blank.soap.subjective && blank.soap.objective && blank.soap.assessment && blank.soap.plan);
        const text = C.buildSoapText(blank, { id: "PT-1001", name: "Rahul Sharma" });
        assert(text.includes("SOAP NOTE"));
        assert(text.includes("Rahul Sharma"));
        const sum = C.buildSummary(blank);
        assert(typeof sum === "string" && sum.length > 0);
    });
    await t("interview questions are not extracted as clinical findings", () => {
        const questionTranscript = "Have you been experiencing any, like, racing of the heart? So just in regards to past medical history, do you have any prior medical conditions?";
        const ex = C.basicExtract(questionTranscript);
        assert.strictEqual(ex.chiefComplaint, "");
        assert.strictEqual(ex.presentIllness, "");
        assert.strictEqual(ex.history, "");
        assert.strictEqual(ex.medications.length, 0);
        const doc = C.docFromExtraction(ex);
        const sum = C.buildSummary(doc);
        assert(!sum.includes("racing of the heart"));
        assert(!sum.includes("prior medical conditions"));
        assert(sum.includes("Not provided — clinician input required"));
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

        // ------------------------------------------------------------------
        // Lab Reports & Multi-Report Comparison Engine Tests
        // ------------------------------------------------------------------
        console.log("Lab Reports & Comparison Engine API");
        await t("catalog returns standard parameters and reference ranges", async () => {
            const res = await fetch(base + "/api/lab-reports/catalog");
            assert.strictEqual(res.status, 200);
            const catalog = await res.json();
            assert(Array.isArray(catalog));
            assert(catalog.some((c) => c.key === "hba1c" && c.category.includes("Glycemic")));
            assert(catalog.some((c) => c.key === "creatinine" && c.category.includes("Renal")));
            assert(catalog.some((c) => c.key === "ldl" && c.category.includes("Lipid")));
        });

        await t("parse endpoint extracts structured parameters from raw lab text", async () => {
            const raw = [
                "COMPREHENSIVE METABOLIC PANEL",
                "Hemoglobin A1c: 7.2 % (Ref: 4.0 - 5.6)",
                "Fasting Blood Glucose: 142 mg/dL",
                "Serum Creatinine: 1.1 mg/dL",
                "Total Cholesterol: 215 mg/dL",
                "Platelet Count: 245 x10^3/uL"
            ].join("\n");
            const res = await fetch(base + "/api/lab-reports/parse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: raw })
            });
            assert.strictEqual(res.status, 200);
            const tests = await res.json();
            assert(Array.isArray(tests));
            assert(tests.length >= 4);
            const hba1c = tests.find((t) => t.key === "hba1c");
            assert(hba1c && hba1c.value === 7.2 && hba1c.status === "HIGH");
            const creat = tests.find((t) => t.key === "creatinine");
            assert(creat && creat.value === 1.1 && creat.status === "NORMAL");
        });

        await t("patient lab reports: list, upload, compare across multiple visits", async () => {
            // 1. List existing reports for PAT-2001
            const listRes = await fetch(base + "/api/patients/PAT-2001/lab-reports");
            assert.strictEqual(listRes.status, 200);
            const list = await listRes.json();
            assert(Array.isArray(list) && list.length >= 2);

            // 2. Upload a new test report for comparison testing
            const newReport = {
                title: "Follow-up Comprehensive Metabolic Check",
                date: "2026-11-20",
                facility: "Metropolis Clinical Labs",
                category: "Comprehensive",
                tests: [
                    { key: "hba1c", name: "Hemoglobin A1c", value: 5.4, unit: "%", min: 4.0, max: 5.6, status: "NORMAL" },
                    { key: "fbg", name: "Fasting Blood Glucose", value: 92, unit: "mg/dL", min: 70, max: 99, status: "NORMAL" },
                    { key: "creatinine", name: "Serum Creatinine", value: 1.05, unit: "mg/dL", min: 0.7, max: 1.3, status: "NORMAL" }
                ]
            };
            const uploadRes = await fetch(base + "/api/patients/PAT-2001/lab-reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newReport)
            });
            assert.strictEqual(uploadRes.status, 201);
            const created = await uploadRes.json();
            assert(created.id && created.title === newReport.title);

            // 3. Multi-report comparison engine
            const cmpRes = await fetch(base + "/api/patients/PAT-2001/lab-reports/compare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportIds: "all" })
            });
            assert.strictEqual(cmpRes.status, 200);
            const comparison = await cmpRes.json();
            assert(comparison.reports && comparison.reports.length >= 4);
            assert(Array.isArray(comparison.parameters));
            assert(typeof comparison.narrative === "string" && comparison.narrative.length > 20);

            // Check parameter tracking with deltas and trajectory
            const hba1cParam = comparison.parameters.find((p) => p.key === "hba1c");
            assert(hba1cParam);
            assert(hba1cParam.values.length >= 4);
            assert.strictEqual(hba1cParam.latestValue, 5.4);
            assert.strictEqual(hba1cParam.direction, "falling"); // 6.8 -> 6.3 -> 5.7 -> 5.4 (normalized)
            assert.strictEqual(hba1cParam.trajectory, "improved");
            assert(hba1cParam.delta < 0);

            // 4. Clean up uploaded test report
            const delRes = await fetch(base + "/api/patients/PAT-2001/lab-reports/" + created.id, {
                method: "DELETE"
            });
            assert([200, 204].includes(delRes.status));
        });
    }
    console.log(failed ? "\n" + failed + " FAILED" : "\nAll tests passed");
    process.exit(failed ? 1 : 0);
})();
