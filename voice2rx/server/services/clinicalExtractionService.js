"use strict";
// Structured clinical extraction. Provider is configurable (LLM_PROVIDER / OLLAMA_MODEL).
// Output is ALWAYS passed through the schema validator; on failure we fall back to the
// rule-based extractor and say so. Transcripts are never logged.
const config = require("../config");
const C = require("../../shared/clinical");

const SYSTEM_PROMPT = [
    "You extract structured information from a doctor-patient consultation transcript.",
    "STRICT RULES:",
    "- Use ONLY information explicitly present in the transcript. Never infer or invent.",
    "- If something is not stated, use an empty string (or empty array).",
    "- Never choose a diagnosis, drug, strength, dose, frequency or duration that was not spoken.",
    "- For each medicine copy the exact sentence into sourceText. Leave unstated medicine fields empty.",
    "- 'assessment' and 'plan' are what the DOCTOR stated; leave empty if absent or 'awaiting'.",
    "- Reply with a single JSON object only, matching exactly the keys below.",
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
        const tags = await ollamaFetch("/api/tags", null, 2000);
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
        parsed[k] = v.map(flat).filter((s) => s && !/^(none|n\/a|not (stated|provided|mentioned))\.?$/i.test(s));
    });
    Object.keys(parsed).forEach((k) => { if (parsed[k] === null) parsed[k] = ""; });
    if (Array.isArray(parsed.medications)) parsed.medications = parsed.medications.filter((m) => m && typeof m === "object" && flat(m.name));
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
//  - current-medication entries that are really the prescribed drugs are removed,
//  - the LLM's free-form missingInfo is replaced by the rule-based list.
function merge(llm, rules) {
    ["patientId", "chiefComplaint", "presentIllness", "symptomDuration", "history", "examination", "testResults", "assessment", "investigations", "plan", "followUp"]
        .forEach((k) => { if (!llm[k] && rules[k]) llm[k] = rules[k]; });
    Object.keys(llm.vitals).forEach((k) => { if (!llm.vitals[k] && rules.vitals[k]) llm.vitals[k] = rules.vitals[k]; });
    const names = new Set(llm.medications.map((m) => m.name.toLowerCase()));
    rules.medications.forEach((m) => { if (!names.has(m.name.toLowerCase())) { llm.medications.push(m); names.add(m.name.toLowerCase()); } });
    if (!rules.currentMedications.length) {
        llm.currentMedications = llm.currentMedications.filter((s) => ![...names].some((n) => s.toLowerCase().includes(n)));
    }
    if (!llm.allergies.length) llm.allergies = rules.allergies;
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
