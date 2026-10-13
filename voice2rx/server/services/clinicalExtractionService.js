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
    const parsed = JSON.parse(data.message && data.message.content);
    const v = C.validateExtraction(parsed);
    if (!v.ok) throw new Error("Model output failed schema validation: " + v.errors.slice(0, 3).join("; "));
    v.value.medications.forEach((m) => { m.verify = true; if (!m.sourceText) m.sourceText = C.findSnippet(transcript, m.name); });
    return v.value;
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
