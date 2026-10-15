"use strict";
// Structured clinical extraction. Provider is configurable (LLM_PROVIDER / OLLAMA_MODEL).
// Output is ALWAYS passed through the schema validator; on failure we fall back to the
// rule-based extractor and say so. Transcripts are never logged.
const config = require("../config");
const C = require("../../shared/clinical");

const SYSTEM_PROMPT = [
    "You are an expert AI clinical documentation specialist extracting structured data from doctor-patient transcripts.",
    "STRICT CLINICAL EXTRACTION RULES:",
    "- Use ONLY facts stated in the transcript. Never infer, diagnose, or hallucinate unstated medical facts.",
    "- If a clinical field is not stated in the transcript, set it to an empty string \"\" (or empty array []).",
    "- CRITICAL ON INTERVIEW QUESTIONS: NEVER extract questions asked by the clinician or patient as complaints, symptoms, or history.",
    "  Example: If doctor asks 'Have you been experiencing racing of the heart?' or 'Do you have prior medical conditions?', this is ONLY A QUESTION.",
    "  It is NOT a patient complaint or history. Leave 'chiefComplaint', 'presentIllness', and 'history' as \"\" unless the patient affirmatively confirms symptoms.",
    "  Never put question sentences or sentences ending in '?' into clinical fields.",
    "- 'chiefComplaint': Confirmed primary symptom or reason for visit (never a question).",
    "- 'presentIllness': Narrative of presenting illness and confirmed symptoms (never questions).",
    "- 'symptomDuration': Stated duration of symptoms (e.g. '3 days', '2 weeks').",
    "- 'history': Relevant past medical, surgical, or chronic conditions confirmed as facts.",
    "- 'currentMedications': Array of regular/pre-existing medications the patient is already taking.",
    "- 'allergies': Array of stated drug or environmental allergies (e.g. ['Penicillin']).",
    "- 'examination': Physical examination observations spoken by the doctor.",
    "- 'vitals': Stated vital signs only (temperature, bloodPressure, pulse, spo2).",
    "- 'testResults': Stated diagnostic or lab results.",
    "- 'assessment': Clinician-stated diagnosis or clinical impression.",
    "- 'investigations': Labs, imaging, or diagnostic tests ordered by the clinician.",
    "- 'plan': Non-drug management, advice, precautions, and instructions.",
    "- 'followUp': Follow-up timeline, next visit, or SOS warning signs.",
    "- 'medications': Array of prescribed medicines with: name, strength, dose, route, frequency, timing, duration, instructions, and exact sourceText sentence from transcript.",
    "- Reply strictly with a single JSON object matching the exact keys below.",
    "{",
    '  "patientId": "", "chiefComplaint": "", "presentIllness": "", "symptomDuration": "",',
    '  "history": "", "currentMedications": [""], "allergies": [""], "examination": "",',
    '  "vitals": {"temperature": "", "bloodPressure": "", "pulse": "", "spo2": ""},',
    '  "testResults": "", "assessment": "", "investigations": "", "plan": "", "followUp": "",',
    '  "medications": [{"name": "", "strength": "", "dose": "", "route": "", "frequency": "", "timing": "", "duration": "", "instructions": "", "sourceText": ""}],',
    '  "missingInfo": [""]',
    "}",
].join("\n");

async function ollamaFetch(path, body, timeoutMs) {
    const res = await fetch(config.llm.url + path, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error("Ollama responded with HTTP " + res.status);
    return res.json();
}

async function status() {
    if (config.llm.provider !== "ollama") return { available: false, provider: "basic", model: "", reason: "LLM_PROVIDER=basic" };
    try {
        const tags = await ollamaFetch("/api/tags", null, 6000);
        const names = (tags.models || []).map((m) => m.name);
        const wanted = config.llm.model;
        const present = names.some((n) => n === wanted || n === wanted + ":latest");
        return present
            ? { available: true, provider: "ollama", model: wanted }
            : { available: false, provider: "ollama", model: wanted, reason: "Ollama is running but model '" + wanted + "' is not pulled (run: ollama pull " + wanted + ")" };
    } catch (e) {
        return { available: false, provider: "ollama", model: config.llm.model, reason: "Ollama is not reachable at " + config.llm.url };
    }
}

// Small local models often return null / nested objects for list fields. Flatten those benign shape
// issues to plain strings; the strict schema validator and transcript-grounding checks still run after.
function coerce(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
    const flat = (x) => (x == null ? "" : typeof x === "string" ? x : typeof x === "object" ? Object.values(x).filter((v) => typeof v === "string" || typeof v === "number").join(" ") : String(x)).trim();
    ["currentMedications", "allergies", "missingInfo"].forEach((k) => {
        let v = parsed[k];
        if (v == null) v = [];
        if (!Array.isArray(v)) v = [v];
        parsed[k] = v.map(flat).filter((s) => s && !C.isQuestion(s) && !/^(none|n\/a|not (stated|provided|mentioned))\.?$/i.test(s));
    });
    ["patientId", "chiefComplaint", "presentIllness", "symptomDuration", "history", "examination", "testResults", "assessment", "investigations", "plan", "followUp"].forEach((k) => {
        if (parsed[k] != null && typeof parsed[k] !== "string") {
            parsed[k] = flat(parsed[k]);
        }
        if (parsed[k]) {
            if (C.isQuestion(parsed[k])) {
                parsed[k] = "";
            } else {
                parsed[k] = parsed[k].split(/(?<=[.!?])\s+/).filter((s) => !C.isQuestion(s)).join(" ").trim();
            }
        }
    });
    Object.keys(parsed).forEach((k) => { if (parsed[k] === null) parsed[k] = ""; });
    if (Array.isArray(parsed.medications)) parsed.medications = parsed.medications.filter((m) => m && typeof m === "object" && flat(m.name) && !C.isQuestion(flat(m.name)));
    if (parsed.vitals && typeof parsed.vitals === "object") Object.keys(parsed.vitals).forEach((k) => { if (parsed.vitals[k] == null) parsed.vitals[k] = ""; });
    return parsed;
}

async function extractWithOllama(transcript) {
    const data = await ollamaFetch("/api/chat", {
        model: config.llm.model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: "Transcript:\n\"\"\"\n" + transcript + "\n\"\"\"" },
        ],
    }, config.llm.timeoutMs);
    const parsed = coerce(JSON.parse(data.message && data.message.content));
    const v = C.validateExtraction(parsed);
    if (!v.ok) throw new Error("Model output failed schema validation: " + v.errors.slice(0, 3).join("; "));
    v.value.medications.forEach((m) => { m.verify = true; if (!m.sourceText) m.sourceText = C.findSnippet(transcript, m.name); });
    return merge(v.value, C.basicExtract(transcript));
}

// Hybrid safety net: small local models mis-file or drop items (e.g. put a prescribed drug under
// "current medications"). The rule-based extractor only copies verbatim transcript text, so:
//  - empty LLM fields are filled from it,
//  - prescribed medicines it found are added if the LLM missed them,
//  - details on existing medicines (strength, frequency, duration) are merged if missing in LLM,
//  - current-medication entries that are really the prescribed drugs are removed,
//  - the LLM's free-form missingInfo is replaced by the rule-based list.
function merge(llm, rules) {
    ["patientId", "chiefComplaint", "presentIllness", "symptomDuration", "history", "examination", "testResults", "assessment", "investigations", "plan", "followUp"]
        .forEach((k) => {
            if (!llm[k] && rules[k] && !C.isQuestion(rules[k])) llm[k] = rules[k];
            if (llm[k] && C.isQuestion(llm[k])) llm[k] = "";
        });
    Object.keys(llm.vitals).forEach((k) => { if (!llm.vitals[k] && rules.vitals[k]) llm.vitals[k] = rules.vitals[k]; });

    // Back-fill chiefComplaint from presentIllness or vice-versa ONLY if not a question
    if (!llm.chiefComplaint && llm.presentIllness && !C.isQuestion(llm.presentIllness)) {
        const firstClause = llm.presentIllness.split(/[.;]/)[0].trim();
        if (!C.isQuestion(firstClause)) llm.chiefComplaint = firstClause;
    }
    if (!llm.presentIllness && llm.chiefComplaint && !C.isQuestion(llm.chiefComplaint)) {
        llm.presentIllness = llm.chiefComplaint;
    }

    // Merge medications
    const validRuleMeds = rules.medications.filter((m) => m && !C.isQuestion(m.name));
    const names = new Set(llm.medications.map((m) => m.name.toLowerCase()));
    llm.medications.forEach((lm) => {
        const rm = validRuleMeds.find((m) => m.name.toLowerCase() === lm.name.toLowerCase());
        if (rm) {
            ["strength", "dose", "route", "frequency", "timing", "duration", "instructions"].forEach((k) => {
                if (!lm[k] && rm[k]) lm[k] = rm[k];
            });
            if (!lm.sourceText && rm.sourceText) lm.sourceText = rm.sourceText;
        }
    });
    validRuleMeds.forEach((m) => { if (!names.has(m.name.toLowerCase())) { llm.medications.push(m); names.add(m.name.toLowerCase()); } });
    if (!rules.currentMedications.length) {
        llm.currentMedications = llm.currentMedications.filter((s) => !C.isQuestion(s) && ![...names].some((n) => s.toLowerCase().includes(n)));
    }
    if (!llm.allergies.length) llm.allergies = rules.allergies.filter((a) => !C.isQuestion(a));
    llm.missingInfo = rules.missingInfo;
    return llm;
}

async function extract(transcript) {
    if (config.llm.provider === "ollama") {
        const st = await status();
        if (st.available) {
            try {
                return { mode: "ollama", model: config.llm.model, extraction: await extractWithOllama(transcript), notice: "" };
            } catch (e) {
                return { mode: "basic", model: "", extraction: C.basicExtract(transcript), notice: "Local LLM output could not be used (" + e.message + "). Rule-based extraction used instead." };
            }
        }
        return { mode: "basic", model: "", extraction: C.basicExtract(transcript), notice: st.reason + ". Rule-based extraction used instead." };
    }
    return { mode: "basic", model: "", extraction: C.basicExtract(transcript), notice: "Rule-based extraction (no LLM configured)." };
}

module.exports = { extract, status };
