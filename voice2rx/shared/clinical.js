/**
 * Voice2Rx shared clinical logic (runs in the browser AND in Node).
 *
 *  - validateExtraction(): constrained-schema validation of extractor output
 *  - basicExtract():       deterministic, rule-based extraction (NO AI). It only
 *                          copies text that is actually present in the transcript.
 *  - docFromExtraction():  maps an extraction into the editable SOAP / Rx document
 *  - validateDocument():   deterministic checks of the (edited) document against
 *                          the original transcript
 *  - text builders for copy / print
 *
 * Nothing here infers drugs, doses, diagnoses or treatment. Missing = empty string.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.V2RClinical = factory();
})(typeof self !== "undefined" ? self : this, function () {

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    var NUM = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|several)";
    var UNIT = "(?:hours?|days?|weeks?|months?|years?)";
    var NOT_PROVIDED = /\b(not provided|not stated|not mentioned|not specified|not available|not discussed|awaiting|pending|to be determined|tbd)\b/i;

    function str(v) { return typeof v === "string" ? v.trim() : ""; }
    function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

    function splitSentences(text) {
        var out = [];
        String(text || "").split(/\n+/).forEach(function (line) {
            line.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).forEach(function (s) {
                s = s.trim();
                if (s) out.push(s);
            });
        });
        return out;
    }

    /** Return the transcript sentence that contains `term` (for "source text" display). */
    function findSnippet(transcript, term) {
        if (!term) return "";
        var t = norm(term);
        var sents = splitSentences(transcript);
        for (var i = 0; i < sents.length; i++) {
            if (norm(sents[i]).indexOf(t) !== -1) return sents[i];
        }
        return "";
    }

    var uid = 0;
    function newId(prefix) { uid += 1; return prefix + Date.now().toString(36) + uid; }

    // ------------------------------------------------------------------
    // Schema
    // ------------------------------------------------------------------
    var MED_FIELDS = ["name", "strength", "dose", "route", "frequency", "timing", "duration", "instructions"];

    function emptyExtraction() {
        return {
            patientId: "", chiefComplaint: "", presentIllness: "", symptomDuration: "",
            history: "", currentMedications: [], allergies: [], examination: "",
            vitals: { temperature: "", bloodPressure: "", pulse: "", spo2: "" },
            testResults: "", assessment: "", investigations: "", plan: "", followUp: "",
            medications: [], missingInfo: []
        };
    }

    function strList(v) {
        if (typeof v === "string") v = v.trim() ? [v] : [];
        if (!Array.isArray(v)) return null;
        return v.every(function (x) { return typeof x === "string"; })
            ? v.map(function (x) { return x.trim(); }).filter(Boolean) : null;
    }

    /**
     * Validate + normalise extractor output (LLM or rule-based).
     * Returns { ok, errors[], value }. Unknown keys are dropped; wrong types are errors.
     */
    function validateExtraction(obj) {
        var errors = [];
        var out = emptyExtraction();
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            return { ok: false, errors: ["Extraction is not a JSON object"], value: out };
        }
        ["patientId", "chiefComplaint", "presentIllness", "symptomDuration", "history", "examination",
            "testResults", "assessment", "investigations", "plan", "followUp"].forEach(function (k) {
                if (obj[k] === undefined || obj[k] === null) return;
                if (typeof obj[k] !== "string") errors.push(k + " must be a string");
                else out[k] = obj[k].trim();
            });
        ["currentMedications", "allergies", "missingInfo"].forEach(function (k) {
            if (obj[k] === undefined || obj[k] === null) return;
            var l = strList(obj[k]);
            if (l === null) errors.push(k + " must be an array of strings"); else out[k] = l;
        });
        if (obj.vitals !== undefined && obj.vitals !== null) {
            if (typeof obj.vitals !== "object") errors.push("vitals must be an object");
            else Object.keys(out.vitals).forEach(function (k) {
                var v = obj.vitals[k];
                if (v === undefined || v === null) return;
                if (typeof v !== "string" && typeof v !== "number") errors.push("vitals." + k + " must be text");
                else out.vitals[k] = String(v).trim();
            });
        }
        if (obj.medications !== undefined && obj.medications !== null) {
            if (!Array.isArray(obj.medications)) errors.push("medications must be an array");
            else obj.medications.forEach(function (m, i) {
                if (!m || typeof m !== "object") { errors.push("medications[" + i + "] must be an object"); return; }
                var med = { id: newId("m"), source: "transcript", verify: true, sourceText: str(m.sourceText) };
                MED_FIELDS.forEach(function (f) {
                    var v = m[f];
                    if (v === undefined || v === null) { med[f] = ""; return; }
                    if (typeof v !== "string" && typeof v !== "number") errors.push("medications[" + i + "]." + f + " must be text");
                    med[f] = String(v === undefined || v === null ? "" : v).trim();
                });
                if (!med.name) { errors.push("medications[" + i + "].name is required"); return; }
                out.medications.push(med);
            });
        }
        return { ok: errors.length === 0, errors: errors, value: out };
    }

    // ------------------------------------------------------------------
    // Rule-based extractor (no AI)
    // ------------------------------------------------------------------
    var KW = {
        complaint: /\b(complain(?:s|ing|t)?(?: of)?|presenting with|presents with|c\/o|came with|chief complaint)\b/i,
        history: /\b(history of|known case of|k\/c\/o|diabetic|hypertensive|asthmatic|past medical|previous(?:ly)?)\b/i,
        curMeds: /\b(currently (?:taking|on)|is taking|already (?:taking|on)|regular medication)\b/i,
        allergy: /\b(allerg(?:y|ic|ies)|nkda)\b/i,
        exam: /\b(on examination|examination|o\/e|examined|auscultation|palpation)\b/i,
        assessment: /\b(assessment|diagnos(?:is|ed)|impression|clinical suspicion)\b/i,
        invest: /\b(investigations?|blood tests?|cbc|x-?ray|ultrasound|urine test|lab test)\b/i,
        follow: /\b(follow[- ]?up|review after|come back|return (?:in|after))\b/i,
        plan: /\b(plan|advise[d]?|advice|recommend(?:ed)?|rest|hydration|refer(?:red)?)\b/i,
        med: /\b(prescrib\w*|medications?|medicines?|tablets?|capsules?|syrup|injection|ointment|drops?|\d+(?:\.\d+)?\s?(?:mg|mcg|ml)\b)/i
    };
    var STOP = ["the", "a", "an", "patient", "tablet", "tablets", "capsule", "capsules", "syrup", "dose", "strength",
        "frequency", "duration", "not", "stated", "as", "needed", "any", "medication", "medications", "medicine",
        "medicines", "anything", "mentioned", "none", "no", "following", "one", "two", "also", "and", "or"];

    function medNames(sentence) {
        var m = sentence.match(/\b(?:prescrib\w*|start(?:ed)?|medications?(?: mentioned| discussed| named| stated)?|medicines?(?: mentioned)?|give|given|take|tablets?|capsules?|syrup|injection|ointment|drops?)\b\s*(?:is|was|are|:|-)?\s*(?:the patient\s+|on\s+|to\s+)?(.+)/i);
        if (!m) return [];
        var tail = m[1].split(/(?:\d|\bfor\b|\btwice\b|\bonce\b|\bthrice\b|\bdaily\b|\bevery\b|\bafter\b|\bbefore\b|\bwith\b|\borally\b|\.|;|,\s*(?:strength|dose|frequency|duration|timing))/i)[0];
        return tail.split(/\s*(?:,|\band\b|\bplus\b)\s*/i).map(function (t) { return t.trim(); }).filter(function (t) {
            if (!/^[A-Za-z][A-Za-z\- ]{2,}$/.test(t)) return false;
            return STOP.indexOf(t.toLowerCase()) === -1;
        });
    }

    function medFields(sentence, single) {
        var f = { strength: "", dose: "", route: "", frequency: "", timing: "", duration: "", instructions: "" };
        if (!single) return f; // several drugs in one sentence: never guess which value belongs to which
        var x;
        if ((x = sentence.match(/(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|iu))\b/i))) f.strength = x[1];
        if ((x = sentence.match(/\b(\d+(?:\.\d+)?|one|two|three|half)\s+(tablets?|capsules?|ml|drops?|puffs?|teaspoons?)/i))) f.dose = x[0];
        if ((x = sentence.match(/\b(once (?:a day|daily)|twice (?:a day|daily)|thrice (?:a day|daily)|three times (?:a|per) day|two times (?:a|per) day|every \d+ hours|at bedtime|at night|as needed|SOS|OD|BD|TDS|QID)\b/i))) f.frequency = x[1];
        if ((x = sentence.match(/\b(after (?:food|meals?)|before (?:food|meals?)|with (?:food|meals?)|empty stomach)\b/i))) f.timing = x[1];
        if ((x = sentence.match(/\b(orally|oral|intravenous(?:ly)?|IV|topical(?:ly)?|intramuscular(?:ly)?|IM|inhaled|sublingual)\b/i))) f.route = x[1];
        if ((x = sentence.match(new RegExp("\\bfor\\s+(?:the next\\s+)?(" + NUM + "\\s*" + UNIT + ")", "i")))) f.duration = x[1];
        return f;
    }

    function basicExtract(transcript) {
        var ex = emptyExtraction();
        var sents = splitSentences(transcript);
        var illness = [], hist = [], exam = [], assess = [], plan = [], inv = [], follow = [];
        var m;

        if ((m = String(transcript).match(/\b(Demo Patient \d+|PT-?\d{3,}|[A-Z]{2,4}-\d{3,})\b/i))) ex.patientId = m[1];

        sents.forEach(function (s) {
            var absent = NOT_PROVIDED.test(s);
            var isMed = KW.med.test(s) && !KW.allergy.test(s);

            if (KW.allergy.test(s)) {
                if (absent) ex.missingInfo.push("Allergies: " + s);
                else if (/\b(no known|nkda|denies)\b/i.test(s)) ex.allergies.push("No known allergies (as stated)");
                else if ((m = s.match(/allergic to ([^.;]+)/i))) ex.allergies.push(m[1].trim());
                else ex.allergies.push(s);
                return;
            }
            if (KW.curMeds.test(s)) {
                if (!absent) ex.currentMedications.push(s);
                return;
            }
            if (KW.exam.test(s)) {
                if (absent) ex.missingInfo.push("Examination: " + s); else exam.push(s);
            }
            if (KW.assessment.test(s)) {
                if (absent) ex.missingInfo.push("Assessment: " + s); else assess.push(s);
                return;
            }
            if (KW.invest.test(s)) {
                if (absent) ex.missingInfo.push("Investigations: " + s); else inv.push(s);
                return;
            }
            if (KW.follow.test(s)) {
                if (absent) ex.missingInfo.push("Follow-up: " + s); else follow.push(s);
                return;
            }
            if (isMed) {
                var names = medNames(s);
                names.forEach(function (n) {
                    var f = medFields(s, names.length === 1);
                    ex.medications.push({
                        id: newId("m"), name: n, strength: f.strength, dose: f.dose, route: f.route,
                        frequency: f.frequency, timing: f.timing, duration: f.duration, instructions: "",
                        sourceText: s, source: "transcript", verify: true
                    });
                });
                return;
            }
            if (KW.exam.test(s)) return;
            if (KW.plan.test(s) && !KW.complaint.test(s)) {
                if (absent) ex.missingInfo.push("Plan: " + s); else plan.push(s);
                return;
            }
            if (KW.complaint.test(s)) {
                var cm = s.match(new RegExp("(?:complain(?:s|ing|t)?(?: of)?|presenting with|presents with|c\\/o|came with|chief complaint(?: is| of)?)\\s*:?\\s+(.+?)(?=\\s+(?:for|since|from)\\s+(?:the\\s+)?(?:last\\s+|past\\s+)?" + NUM + "\\s*" + UNIT + "|[.;]|$)", "i"));
                if (cm && !ex.chiefComplaint) ex.chiefComplaint = cm[1].trim();
                illness.push(s);
            }
            if (KW.history.test(s) && !KW.complaint.test(s)) { hist.push(s); return; }
            var d = s.match(new RegExp("\\b(?:for|since|from)\\s+(?:the\\s+)?(?:last\\s+|past\\s+)?(" + NUM + "\\s*" + UNIT + ")", "i"));
            if (d && !ex.symptomDuration) {
                ex.symptomDuration = d[1];
                if (illness.indexOf(s) === -1) illness.push(s);
            }
        });

        // Vitals (only if explicitly stated)
        var t = String(transcript);
        if ((m = t.match(/\b(?:temperature|temp)\s*(?:is|was|of|:)?\s*(\d{2,3}(?:\.\d)?)\s*(°?\s?[CF]\b|degrees?(?: celsius| fahrenheit)?)?/i))) ex.vitals.temperature = (m[1] + " " + (m[2] || "")).trim();
        if ((m = t.match(/\b(?:blood pressure|bp)\s*(?:is|was|of|:)?\s*(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/i))) ex.vitals.bloodPressure = m[1] + "/" + m[2];
        if ((m = t.match(/\b(?:pulse|heart rate)\s*(?:is|was|of|:)?\s*(\d{2,3})/i))) ex.vitals.pulse = m[1];
        if ((m = t.match(/\b(?:spo2|oxygen saturation)\s*(?:is|was|of|:)?\s*(\d{2,3})\s*%?/i))) ex.vitals.spo2 = m[1] + "%";

        ex.presentIllness = illness.join(" ");
        ex.history = hist.join(" ");
        ex.examination = exam.join(" ");
        ex.assessment = assess.join(" ");
        ex.plan = plan.join(" ");
        ex.investigations = inv.join(" ");
        ex.followUp = follow.join(" ");
        return ex;
    }

    // ------------------------------------------------------------------
    // Editable document (SOAP + prescription + summary)
    // ------------------------------------------------------------------
    function vitalsText(v) {
        var p = [];
        if (v.temperature) p.push("Temperature: " + v.temperature);
        if (v.bloodPressure) p.push("BP: " + v.bloodPressure);
        if (v.pulse) p.push("Pulse: " + v.pulse);
        if (v.spo2) p.push("SpO2: " + v.spo2);
        return p.join("; ");
    }

    function docFromExtraction(ex, patient) {
        var sym = [ex.presentIllness, ex.symptomDuration ? "Duration stated: " + ex.symptomDuration : ""].filter(Boolean).join("\n");
        var hist = [
            ex.history,
            ex.currentMedications.length ? "Current medications: " + ex.currentMedications.join("; ") : "",
            ex.allergies.length ? "Allergies: " + ex.allergies.join("; ") : ""
        ].filter(Boolean).join("\n");
        return {
            statedPatientId: ex.patientId,
            soap: {
                subjective: { chiefComplaint: ex.chiefComplaint, symptoms: sym, history: hist },
                objective: { examination: ex.examination, vitals: vitalsText(ex.vitals), tests: ex.testResults },
                assessment: { assessment: ex.assessment },
                plan: { investigations: ex.investigations, treatment: ex.plan, followUp: ex.followUp }
            },
            allergiesStated: ex.allergies.length > 0,
            prescription: {
                date: new Date().toISOString().slice(0, 10),
                followUp: ex.followUp,
                meds: ex.medications.map(function (m) { return Object.assign({}, m); })
            },
            summary: "",
            missingInfo: ex.missingInfo.slice()
        };
    }

    var NP = "Not provided";

    function buildSummary(doc) {
        var s = doc.soap;
        function v(x) { return (x || "").trim() || NP; }
        var meds = doc.prescription.meds.filter(function (m) { return m.name; })
            .map(function (m) { return m.name + (m.strength ? " " + m.strength : ""); });
        return [
            "Main complaint: " + v(s.subjective.chiefComplaint),
            "Important history: " + v(s.subjective.history),
            "Findings mentioned: " + v([s.objective.examination, s.objective.vitals, s.objective.tests].filter(Boolean).join(" | ")),
            "Clinician-stated assessment: " + (s.assessment.assessment.trim() || "Not stated - awaiting clinician assessment"),
            "Plan: " + (s.plan.treatment.trim() || s.plan.investigations.trim()
                ? [s.plan.investigations, s.plan.treatment].filter(function (x) { return x && x.trim(); }).join(" | ")
                : "Not stated - awaiting clinician input"),
            "Medications mentioned: " + (meds.length ? meds.join(", ") + " (details need clinician confirmation)" : NP),
            "Follow-up: " + v(s.plan.followUp)
        ].join("\n");
    }

    function buildSoapText(doc, patient) {
        var s = doc.soap;
        function v(x) { return (x || "").trim() || "[Not provided - clinician input required]"; }
        return [
            "SOAP NOTE" + (doc.demo ? " (DEMO DATA)" : "") + " - AI-generated draft, verify before approval",
            "Patient: " + (patient ? patient.name + " (" + patient.id + ")" : "Not selected"),
            "",
            "S - SUBJECTIVE",
            "Chief complaint: " + v(s.subjective.chiefComplaint),
            "Symptoms & duration: " + v(s.subjective.symptoms),
            "Relevant history: " + v(s.subjective.history),
            "",
            "O - OBJECTIVE",
            "Examination: " + v(s.objective.examination),
            "Vital signs: " + v(s.objective.vitals),
            "Test results: " + v(s.objective.tests),
            "",
            "A - ASSESSMENT",
            v(s.assessment.assessment),
            "",
            "P - PLAN",
            "Investigations: " + v(s.plan.investigations),
            "Treatment plan: " + v(s.plan.treatment),
            "Follow-up: " + v(s.plan.followUp)
        ].join("\n");
    }

    function buildRxText(doc, patient) {
        var rx = doc.prescription;
        var lines = [
            "PRESCRIPTION" + (doc.demo ? " (DEMO DATA)" : "") + " - " + (rx.approved ? "APPROVED" : "DRAFT, NOT APPROVED"),
            "Patient: " + (patient ? patient.name + " (" + patient.id + ")" : "Not selected"),
            "Date: " + rx.date, ""
        ];
        if (!rx.meds.length) lines.push("No medicines recorded.");
        rx.meds.forEach(function (m, i) {
            lines.push((i + 1) + ". " + (m.name || "[name missing]") +
                " | Strength: " + (m.strength || "-") + " | Dose: " + (m.dose || "-") + " | Route: " + (m.route || "-") +
                " | Frequency: " + (m.frequency || "-") + " | Timing: " + (m.timing || "-") +
                " | Duration: " + (m.duration || "-") + (m.instructions ? " | Notes: " + m.instructions : "") +
                (m.verify ? "  [NEEDS VERIFICATION]" : ""));
        });
        lines.push("", "Follow-up: " + (rx.followUp || "Not provided"));
        return lines.join("\n");
    }

    // ------------------------------------------------------------------
    // Deterministic validation of the working document vs. the transcript
    // ------------------------------------------------------------------
    /**
     * @param {object} doc      working document ({soap, prescription, statedPatientId, ...})
     * @param {string} transcript original transcript (reference)
     * @param {object|null} patient selected patient {id,name}
     * @param {object} ctx      { transcriptionFailed, transcriptSource }
     * Severity: "error" (blocks approval), "warning" (needs review), "info".
     */
    function validateDocument(doc, transcript, patient, ctx) {
        ctx = ctx || {};
        var issues = [];
        var T = norm(transcript);
        function add(severity, id, title, detail, field, source) {
            issues.push({ id: id, severity: severity, title: title, detail: detail || "", field: field || "", source: source || "" });
        }

        if (ctx.transcriptionFailed) add("error", "tx-failed", "Transcription failed or incomplete", "Retry transcription or edit the transcript manually.", "transcript");
        if (!T) add("error", "tx-empty", "Transcript is empty", "Record, upload, or load a transcript first.", "transcript");
        else if (T.length < 40) add("warning", "tx-short", "Transcript is very short", "The note may be incomplete. Review carefully.", "transcript", transcript.trim());

        if (!patient) add("warning", "pt-missing", "No patient selected", "Select a patient so the note is linked to the right record.", "patient");
        else if (doc.statedPatientId && norm(doc.statedPatientId) !== norm(patient.id) && norm(doc.statedPatientId) !== norm(patient.name)) {
            add("warning", "pt-mismatch", "Patient mismatch", "Transcript mentions \"" + doc.statedPatientId + "\" but the selected patient is " + patient.name + " (" + patient.id + ").", "patient", findSnippet(transcript, doc.statedPatientId));
        }

        var s = doc.soap;
        if (!s.subjective.chiefComplaint.trim()) add("error", "cc-missing", "Missing required field: chief complaint", "No chief complaint could be identified in the transcript.", "subjective.chiefComplaint");
        if (!s.objective.examination.trim()) add("info", "exam-missing", "Examination findings not provided", "Left blank. Nothing was inferred.", "objective.examination", findSnippet(transcript, "examination"));
        if (!s.assessment.assessment.trim()) add("warning", "assess-missing", "No clinician-stated assessment", "Awaiting clinician input. The system does not make diagnoses.", "assessment.assessment", findSnippet(transcript, "assessment"));
        if (!s.plan.treatment.trim() && !s.plan.investigations.trim()) add("warning", "plan-missing", "No plan stated", "Awaiting clinician input.", "plan.treatment", findSnippet(transcript, "plan"));
        if (!s.plan.followUp.trim()) add("info", "fu-missing", "Follow-up not stated", "", "plan.followUp");
        if (!doc.allergiesStated) add("info", "allergy-unknown", "Allergy status not stated", "No allergy information was found in the transcript.", "subjective.history");

        doc.prescription.meds.forEach(function (m, idx) {
            var label = "Medicine " + (idx + 1) + (m.name ? " (" + m.name + ")" : "");
            var f = function (k) { return "med." + m.id + "." + k; };
            if (!m.name.trim()) { add("error", "med-name-" + m.id, label + ": name missing", "Medicine name is required.", f("name")); return; }
            var snippet = m.sourceText || findSnippet(transcript, m.name);
            if (m.source === "transcript") {
                if (T && T.indexOf(norm(m.name)) === -1) add("error", "med-ground-" + m.id, label + ": name not found in transcript", "The extracted name does not appear in the transcript. Confirm or correct it.", f("name"), snippet);
                ["strength", "frequency", "duration", "dose"].forEach(function (k) {
                    if (m[k] && T && T.indexOf(norm(m[k])) === -1) add("warning", "med-ground-" + k + "-" + m.id, label + ": " + k + " not found verbatim in transcript", "Value \"" + m[k] + "\" was not found in the transcript text. Confirm it.", f(k), snippet);
                });
            } else {
                add("info", "med-manual-" + m.id, label + ": entered manually", "Added or edited by the clinician; not from the transcript.", f("name"));
            }
            if (m.name.trim().length < 3 || /[?]|\bor\b|maybe|not sure|unclear|inaudible/i.test(m.name + " " + (m.sourceText || ""))) {
                add("warning", "med-ambig-" + m.id, label + ": ambiguous medication name", "Manual confirmation required.", f("name"), snippet);
            }
            var missing = ["strength", "dose", "frequency", "duration"].filter(function (k) { return !String(m[k] || "").trim(); });
            if (missing.length) {
                add("warning", "med-missing-" + m.id, label + ": needs confirmation", "Not stated: " + missing.join(", ") + ". These are never inferred - the doctor must enter them.", f(missing[0]), snippet);
                issues[issues.length - 1].fields = missing.map(f);
            }
            if (m.verify) add("info", "med-flag-" + m.id, label + ": marked for verification", "Clear the flag once you have confirmed this row.", f("name"));
        });

        return issues;
    }

    return {
        emptyExtraction: emptyExtraction, validateExtraction: validateExtraction, basicExtract: basicExtract,
        docFromExtraction: docFromExtraction, validateDocument: validateDocument,
        buildSummary: buildSummary, buildSoapText: buildSoapText, buildRxText: buildRxText,
        findSnippet: findSnippet, splitSentences: splitSentences, newId: newId, MED_FIELDS: MED_FIELDS
    };
});
