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
    // Question & inquiry filter
    // ------------------------------------------------------------------
    function isQuestion(s) {
        if (!s || typeof s !== "string") return false;
        var trimmed = s.trim();
        if (!trimmed) return false;
        var clean = trimmed.replace(/^(?:Doctor|Dr\.?|Clinician|Physician|Patient|Pt\.?)\s*:\s*/i, "").trim();
        if (!clean) return false;

        // If the sentence has a question mark
        if (clean.indexOf("?") !== -1) {
            // Check if it is followed by an affirmative clinical answer
            var parts = clean.split("?").map(function (p) { return p.trim(); }).filter(Boolean);
            if (parts.length > 1) {
                var after = parts[parts.length - 1];
                if (/\b(yes|no|none|since|for|started|presents?|complains?|has|have|pain|fever|cough|headache|diagnos|prescrib|take|taking)\b/i.test(after)) {
                    return false;
                }
            }
            return true;
        }

        if (/^(?:what|when|where|which|who|whom|whose|why|how)\b/i.test(clean) && !/\b(diagnos|prescrib|assessment|impression)\b/i.test(clean)) return true;
        if (/^(?:do|does|did|have|has|had|are|is|was|were|can|could|would|will|shall|should|may|might)\s+(?:you|we|the patient|there|it)\b/i.test(clean) && !/\b(for \d+|since \d+|started|diagnos|prescrib)\b/i.test(clean)) return true;
        if (/^(?:tell me|can you tell me|could you tell me|please tell me|let me know)\s+(?:if|about|whether|what|how)/i.test(clean)) return true;
        if (/^(?:any|any other|is there any|are there any)\s+(?:like\s+)?(?:racing|palpitations|chest pain|shortness|fever|cough|pain|allergies|history|medications|issues|symptoms|trouble|difficulty|nausea|vomiting|headache|past medical|prior medical)\??$/i.test(clean)) return true;
        return false;
    }

    // ------------------------------------------------------------------
    // Rule-based extractor (no AI)
    // ------------------------------------------------------------------
    var KW = {
        complaint: /\b(complain(?:s|ing|t)?(?: of)?|presenting with|presents with|c\/o|came with|chief complaint|reports?(?: of)?|experienc\w*|suffering from|has been having|has had|\bhas\b|\bhaving\b|\bhave\b|hurts|pain|sore throat|fever|headache|cough|chest pain|abdominal pain|body ache|chills|vomiting|nausea|diarrhea|shortness of breath|breathlessness|rash|swelling|^S\b|^Subjective\b)\b/i,
        history: /\b(history of|known case of|k\/c\/o|diabetic|hypertensive|asthmatic|asthma|diabetes|hypertension|past medical|previous(?:ly)?|prior history)\b/i,
        curMeds: /\b(currently (?:taking|on)|is taking|already (?:taking|on)|regular medication)\b/i,
        allergy: /\b(allerg(?:y|ic|ies)|nkda)\b/i,
        exam: /\b(on examination|examination|o\/e|examined|let me examine|tonsils|lungs|heart|abdomen|throat shows|exam shows|auscultation|palpation|otoscopy|chest clear|per abdomen|vitals?|general condition|^O\b|^Objective\b|^Exam\b)\b/i,
        assessment: /\b(assessment|diagnos(?:is|ed)|impression|clinical suspicion|differential|provisional|you have\b|^A\b|^Assessment\b|^Impression\b)\b/i,
        invest: /\b(investigations?|blood tests?|cbc|x-?ray|ultrasound|urine test|lab test|mri|ct scan|ecg)\b/i,
        follow: /\b(follow[- ]?up|review (?:after|in)|come back|return (?:in|after)|revisit|next visit|f\/u)\b/i,
        plan: /\b(plan|advise[d]?|advice|recommend(?:ed)?|rest|hydration|drink|warm liquids|refer(?:red)?|precautions?|treatment|management|^P\b|^Plan\b|^Treatment\b|^Rx\b)\b/i,
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

        if ((m = String(transcript).match(/\b(Demo Patient \d+|PT-?\d{3,}|PAT-?\d{3,}|[A-Z]{2,4}-\d{3,})\b/i))) ex.patientId = m[1];

        sents.forEach(function (s) {
            if (isQuestion(s)) return;
            var absent = NOT_PROVIDED.test(s);
            var isMed = KW.med.test(s) && !KW.allergy.test(s);

            if (KW.allergy.test(s)) {
                if (absent) ex.missingInfo.push("Allergies: " + s);
                else if (/\b(no known|nkda|denies)\b/i.test(s)) ex.allergies.push("No known allergies (as stated)");
                else if ((m = s.match(/allergic to ([^.;]+)/i))) {
                    var allg = m[1].trim();
                    if (!isQuestion(allg)) ex.allergies.push(allg);
                } else if (!isQuestion(s)) ex.allergies.push(s);
                return;
            }
            if (KW.curMeds.test(s)) {
                if (!absent && !isQuestion(s)) ex.currentMedications.push(s);
                return;
            }
            if (KW.exam.test(s)) {
                if (absent) ex.missingInfo.push("Examination: " + s);
                else {
                    var exTxt = s.replace(/^(?:O\s*:\s*|Objective\s*:\s*|Exam\s*:\s*)/i, "").trim();
                    if (!isQuestion(exTxt)) exam.push(exTxt);
                }
            }
            if (KW.assessment.test(s)) {
                if (absent) ex.missingInfo.push("Assessment: " + s);
                else {
                    var asTxt = s.replace(/^(?:A\s*:\s*|Assessment\s*:\s*|Impression\s*:\s*)/i, "").trim();
                    if (!isQuestion(asTxt)) assess.push(asTxt);
                }
                return;
            }
            if (KW.invest.test(s)) {
                if (absent) ex.missingInfo.push("Investigations: " + s);
                else {
                    var invTxt = s.replace(/^(?:Investigations?\s*:\s*|Labs?\s*:\s*)/i, "").trim();
                    if (!isQuestion(invTxt)) inv.push(invTxt);
                }
                return;
            }
            if (KW.follow.test(s)) {
                if (absent) ex.missingInfo.push("Follow-up: " + s);
                else {
                    var foTxt = s.replace(/^(?:Follow[- ]?up\s*:\s*|Review\s*:\s*)/i, "").trim();
                    if (!isQuestion(foTxt)) follow.push(foTxt);
                }
                return;
            }
            if (isMed) {
                var names = medNames(s);
                names.forEach(function (n) {
                    if (isQuestion(n)) return;
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
                if (absent) ex.missingInfo.push("Plan: " + s);
                else {
                    var plTxt = s.replace(/^(?:P\s*:\s*|Plan\s*:\s*|Treatment\s*:\s*)/i, "").trim();
                    if (!isQuestion(plTxt)) plan.push(plTxt);
                }
                return;
            }
            if (KW.complaint.test(s)) {
                var cleanS = s.replace(/^(?:S\s*:\s*|Subjective\s*:\s*)/i, "").trim();
                if (!isQuestion(cleanS)) {
                    var cm = cleanS.match(new RegExp("(?:complain(?:s|ing|t)?(?: of)?|presenting with|presents with|c\\/o|came with|chief complaint(?: is| of)?|reports?(?: of)?|experienc(?:ing|ed)|suffering from|has had|has|having)\\s*:?\\s+(.+?)(?=\\s+(?:for|since|from)\\s+(?:the\\s+)?(?:last\\s+|past\\s+)?" + NUM + "\\s*" + UNIT + "|[.;]|$)", "i"));
                    if (cm) {
                        var cand = cm[1].trim();
                        if (!isQuestion(cand) && !ex.chiefComplaint) ex.chiefComplaint = cand;
                    }
                    illness.push(cleanS);
                }
            }
            if (KW.history.test(s) && !KW.complaint.test(s)) {
                if (!isQuestion(s)) hist.push(s);
                return;
            }
            var d = s.match(new RegExp("\\b(?:for|since|from)\\s+(?:the\\s+)?(?:last\\s+|past\\s+)?(" + NUM + "\\s*" + UNIT + ")", "i"));
            if (d && !ex.symptomDuration && !isQuestion(s)) {
                ex.symptomDuration = d[1];
                if (illness.indexOf(s) === -1) illness.push(s);
            }
        });

        // Fallback for chiefComplaint if not captured yet
        if (!ex.chiefComplaint && illness.length) {
            for (var i = 0; i < illness.length; i++) {
                var first = illness[i]
                    .replace(/^(?:Patient\s*:\s*|Patient\s+(?:Demo Patient \d+|PT-?\d+|PAT-?\d+|[A-Z]{2,4}-\d+)\s*,?\s*|Patient\s*,?\s*|^S\s*:\s*|^Subjective\s*:\s*)/i, "")
                    .replace(/^(?:reports?(?: of)?|has(?: had)?|came with|presents? with|complains?(?: of)?|is having|having|have|suffering from)\s*:?\s*/i, "")
                    .trim();
                if (isQuestion(first)) continue;
                var mDur = first.match(new RegExp("(.+?)(?=\\s+(?:for|since|from)\\s+(?:the\\s+)?(?:last\\s+|past\\s+)?" + NUM + "\\s*" + UNIT + "|[.;]|$)", "i"));
                if (mDur && mDur[1].trim() && !isQuestion(mDur[1].trim()) && !new RegExp("^" + NUM + "\\s*" + UNIT + "$", "i").test(mDur[1].trim())) {
                    ex.chiefComplaint = mDur[1].trim();
                    break;
                } else if (first && !isQuestion(first) && !new RegExp("^" + NUM + "\\s*" + UNIT + "$", "i").test(first)) {
                    ex.chiefComplaint = first;
                    break;
                }
            }
        }

        // Vitals (only if explicitly stated)
        var t = String(transcript);
        if ((m = t.match(/\b(?:temperature|temp)\s*(?:is|was|of|:)?\s*(\d{2,3}(?:\.\d)?)\s*(°?\s?[CF]\b|degrees?(?: celsius| fahrenheit)?)?/i))) ex.vitals.temperature = (m[1] + " " + (m[2] || "")).trim();
        if ((m = t.match(/\b(?:blood pressure|bp)\s*(?:is|was|of|:)?\s*(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/i))) ex.vitals.bloodPressure = m[1] + "/" + m[2];
        if ((m = t.match(/\b(?:pulse|heart rate)\s*(?:is|was|of|:)?\s*(\d{2,3})/i))) ex.vitals.pulse = m[1];
        if ((m = t.match(/\b(?:spo2|oxygen saturation)\s*(?:is|was|of|:)?\s*(\d{2,3})\s*%?/i))) ex.vitals.spo2 = m[1] + "%";

        ex.presentIllness = illness.filter(function (line) { return !isQuestion(line); }).join(" ");
        ex.history = hist.filter(function (line) { return !isQuestion(line); }).join(" ");
        ex.examination = exam.filter(function (line) { return !isQuestion(line); }).join(" ");
        ex.assessment = assess.filter(function (line) { return !isQuestion(line); }).join(" ");
        ex.plan = plan.filter(function (line) { return !isQuestion(line); }).join(" ");
        ex.investigations = inv.filter(function (line) { return !isQuestion(line); }).join(" ");
        ex.followUp = follow.filter(function (line) { return !isQuestion(line); }).join(" ");

        if (isQuestion(ex.chiefComplaint)) ex.chiefComplaint = "";
        if (isQuestion(ex.presentIllness)) ex.presentIllness = "";
        if (isQuestion(ex.history)) ex.history = "";
        if (isQuestion(ex.examination)) ex.examination = "";
        if (isQuestion(ex.assessment)) ex.assessment = "";
        if (isQuestion(ex.plan)) ex.plan = "";
        if (isQuestion(ex.investigations)) ex.investigations = "";
        if (isQuestion(ex.followUp)) ex.followUp = "";
        return ex;
    }

    // ------------------------------------------------------------------
    // Editable document (SOAP + prescription + summary)
    // ------------------------------------------------------------------
    function vitalsText(v) {
        if (!v) return "";
        if (typeof v === "string") return v.trim();
        if (typeof v !== "object") return "";
        var p = [];
        if (v.temperature) p.push("Temperature: " + v.temperature);
        if (v.bloodPressure) p.push("BP: " + v.bloodPressure);
        if (v.pulse) p.push("Pulse: " + v.pulse);
        if (v.spo2) p.push("SpO2: " + v.spo2);
        if (v.respiratoryRate) p.push("RR: " + v.respiratoryRate);
        return p.join("; ");
    }

    function docFromExtraction(ex, patient) {
        ex = ex || emptyExtraction();
        var rawSym = [ex.presentIllness, ex.symptomDuration ? "Duration stated: " + ex.symptomDuration : ""].filter(Boolean).join("\n");
        var sym = rawSym.split(/\n+/).filter(function (l) { return l.trim() && !isQuestion(l); }).join("\n");
        var curMeds = Array.isArray(ex.currentMedications) ? ex.currentMedications : (typeof ex.currentMedications === "string" && ex.currentMedications.trim() ? [ex.currentMedications.trim()] : []);
        var allergies = Array.isArray(ex.allergies) ? ex.allergies : (typeof ex.allergies === "string" && ex.allergies.trim() ? [ex.allergies.trim()] : []);
        var histParts = [];
        if (ex.history && !isQuestion(ex.history)) histParts.push(typeof ex.history === "string" ? ex.history.trim() : JSON.stringify(ex.history));
        curMeds.forEach(function (m) { if (!isQuestion(m)) histParts.push("Current medications: " + m); });
        allergies.forEach(function (a) { if (!isQuestion(a)) histParts.push("Allergies: " + a); });
        var hist = histParts.filter(Boolean).join("\n");
        var meds = Array.isArray(ex.medications) ? ex.medications.filter(function (m) { return m && !isQuestion(m.name); }) : [];
        var missingInfo = Array.isArray(ex.missingInfo) ? ex.missingInfo : [];

        var cc = isQuestion(ex.chiefComplaint) ? "" : (ex.chiefComplaint || "");

        return {
            statedPatientId: ex.patientId || (patient && patient.id) || "",
            soap: {
                subjective: { chiefComplaint: cc, symptoms: sym || "", history: hist || "" },
                objective: {
                    examination: isQuestion(ex.examination) ? "" : (ex.examination || ""),
                    vitals: vitalsText(ex.vitals),
                    tests: isQuestion(ex.testResults) ? "" : (ex.testResults || "")
                },
                assessment: { assessment: isQuestion(ex.assessment) ? "" : (ex.assessment || "") },
                plan: {
                    investigations: isQuestion(ex.investigations) ? "" : (ex.investigations || ""),
                    treatment: isQuestion(ex.plan) ? "" : (ex.plan || ""),
                    followUp: isQuestion(ex.followUp) ? "" : (ex.followUp || "")
                }
            },
            allergiesStated: allergies.length > 0,
            prescription: {
                date: new Date().toISOString().slice(0, 10),
                followUp: isQuestion(ex.followUp) ? "" : (ex.followUp || ""),
                meds: meds.map(function (m) { return Object.assign({}, m); })
            },
            summary: "",
            missingInfo: missingInfo.slice()
        };
    }

    function emptyDoc(patient) {
        return docFromExtraction(emptyExtraction(), patient);
    }

    var NP = "Not provided";

    function buildSummary(doc, patient, doctorName) {
        if (!doc) return NP;
        var s = doc.soap || {};
        var subj = s.subjective || {};
        var obj = s.objective || {};
        var assess = s.assessment || {};
        var pl = s.plan || {};
        var rx = doc.prescription || { meds: [] };

        var pName = (patient && patient.name) || doc.statedPatientId || "Not selected";
        var pId = (patient && patient.id) || (doc.statedPatientId ? doc.statedPatientId : "");
        var dateStr = rx.date || new Date().toISOString().slice(0, 10);
        var docStr = doctorName || "Attending Physician";

        var out = [];

        // Title & metadata banner
        out.push("CONSULTATION SUMMARY" + (doc.demo ? " (DEMO DATA)" : ""));
        out.push("================================================================================");
        out.push("Patient: " + pName + (pId && pId !== pName ? " (" + pId + ")" : "") + " | Date: " + dateStr + " | Doctor: " + docStr);
        out.push("");

        // 1. Chief Complaint
        var cc = (subj.chiefComplaint || "").trim();
        if (isQuestion(cc)) cc = "";
        if (!cc && subj.symptoms) {
            var symFirst = subj.symptoms.split(/\n+/).find(function (l) { return l.trim() && !isQuestion(l); }) || "";
            if (symFirst) {
                cc = symFirst
                    .replace(/^(?:Patient\s*:\s*|Patient\s+(?:Demo Patient \d+|PT-?\d+|PAT-?\d+|[A-Z]{2,4}-\d+)\s*,?\s*|Patient\s*,?\s*|^S\s*:\s*|^Subjective\s*:\s*)/i, "")
                    .replace(/^(?:reports?(?: of)?|has(?: had)?|came with|presents? with|complains?(?: of)?|is having|having|have|suffering from)\s*:?\s*/i, "")
                    .replace(/^Duration stated:.*$/i, "")
                    .trim();
            }
        }
        out.push("1. CHIEF COMPLAINT:");
        out.push("   " + (cc || "Not provided \u2014 clinician input required"));
        out.push("");

        // 2. Symptoms & Present Illness
        var sym = (subj.symptoms || "").trim();
        var symLines = sym.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) {
            return l && !isQuestion(l);
        });
        var cleanSym = symLines.join("\n");
        out.push("2. SYMPTOMS & PRESENT ILLNESS:");
        out.push("   " + (cleanSym || (cc ? "Presenting with " + cc + "." : "Not provided")));
        out.push("");

        // 3. Medical History & Allergies
        var hist = (subj.history || "").trim();
        out.push("3. RELEVANT MEDICAL HISTORY & ALLERGIES:");
        var validHist = [];
        if (hist) {
            hist.split(/\n+/).forEach(function (h) {
                var clean = h.trim();
                if (clean && !isQuestion(clean)) validHist.push(clean);
            });
        }
        if (validHist.length) {
            validHist.forEach(function (clean) {
                out.push("   \u2022 " + clean);
            });
        } else {
            out.push("   \u2022 Medical History: None reported");
            out.push("   \u2022 Allergies: " + (doc.allergiesStated ? "Recorded in chart" : "Not stated"));
        }
        out.push("");

        // 4. Objective Findings & Vitals
        var vitals = (obj.vitals || "").trim();
        if (isQuestion(vitals)) vitals = "";
        var exam = (obj.examination || "").trim();
        if (isQuestion(exam)) exam = "";
        var tests = (obj.tests || "").trim();
        if (isQuestion(tests)) tests = "";
        out.push("4. OBJECTIVE FINDINGS & VITALS:");
        out.push("   \u2022 Vital Signs: " + (vitals || "Not provided"));
        out.push("   \u2022 Physical Examination: " + (exam || "Not stated"));
        if (tests) out.push("   \u2022 Diagnostic Tests: " + tests);
        out.push("");

        // 5. Clinical Assessment / Diagnosis
        var asmt = (assess.assessment || "").trim();
        if (isQuestion(asmt)) asmt = "";
        out.push("5. CLINICAL ASSESSMENT / DIAGNOSIS:");
        out.push("   " + (asmt || "Awaiting clinician assessment"));
        out.push("");

        // 6. Treatment Plan & Management
        var inv = (pl.investigations || "").trim();
        if (isQuestion(inv)) inv = "";
        var trt = (pl.treatment || "").trim();
        if (isQuestion(trt)) trt = "";
        out.push("6. TREATMENT PLAN & MANAGEMENT:");
        out.push("   \u2022 Plan & Advice: " + (trt || "Awaiting clinician plan"));
        if (inv) out.push("   \u2022 Investigations Ordered: " + inv);
        out.push("");

        // 7. Prescribed Medications
        var meds = (rx.meds || []).filter(function (m) { return m && !isQuestion(m.name); });
        out.push("7. PRESCRIBED MEDICATIONS:");
        if (meds.length) {
            meds.forEach(function (m, i) {
                var details = [];
                if (m.strength) details.push(m.strength);
                if (m.dose) details.push(m.dose);
                if (m.route) details.push(m.route);
                if (m.frequency) details.push(m.frequency);
                if (m.timing) details.push(m.timing);
                if (m.duration) details.push("for " + m.duration);
                if (m.instructions && !isQuestion(m.instructions)) details.push("Notes: " + m.instructions);
                var detStr = details.length ? " \u2014 " + details.join(" | ") : " \u2014 (dosage/frequency not stated)";
                out.push("   " + (i + 1) + ". " + (m.name || "Unnamed medicine") + detStr + (m.verify ? " [NEEDS VERIFICATION]" : ""));
            });
        } else {
            out.push("   No medications prescribed.");
        }
        out.push("");

        // 8. Follow-Up
        var fu = (pl.followUp || rx.followUp || "").trim();
        if (isQuestion(fu)) fu = "";
        out.push("8. FOLLOW-UP INSTRUCTIONS:");
        out.push("   " + (fu || "Not stated \u2014 advise as clinically indicated"));

        return out.join("\n");
    }

    function buildSoapText(doc, patient) {
        if (!doc) return "SOAP NOTE - No document active";
        var s = doc.soap || {};
        var subj = s.subjective || {};
        var obj = s.objective || {};
        var assess = s.assessment || {};
        var pl = s.plan || {};

        function v(x) {
            var t = (x || "").trim();
            return (!t || isQuestion(t)) ? "[Not provided - clinician input required]" : t;
        }
        return [
            "SOAP NOTE" + (doc.demo ? " (DEMO DATA)" : "") + " - AI-generated draft, verify before approval",
            "Patient: " + (patient ? patient.name + " (" + patient.id + ")" : "Not selected"),
            "",
            "S - SUBJECTIVE",
            "Chief complaint: " + v(subj.chiefComplaint),
            "Symptoms & duration: " + v(subj.symptoms),
            "Relevant history: " + v(subj.history),
            "",
            "O - OBJECTIVE",
            "Examination: " + v(obj.examination),
            "Vital signs: " + v(obj.vitals),
            "Test results: " + v(obj.tests),
            "",
            "A - ASSESSMENT",
            v(assess.assessment),
            "",
            "P - PLAN",
            "Investigations: " + v(pl.investigations),
            "Treatment plan: " + v(pl.treatment),
            "Follow-up: " + v(pl.followUp)
        ].join("\n");
    }

    function buildRxText(doc, patient) {
        if (!doc) return "PRESCRIPTION - No document active";
        var rx = doc.prescription || { meds: [] };
        var lines = [
            "PRESCRIPTION" + (doc.demo ? " (DEMO DATA)" : "") + " - " + (rx.approved ? "APPROVED" : "DRAFT, NOT APPROVED"),
            "Patient: " + (patient ? patient.name + " (" + patient.id + ")" : "Not selected"),
            "Date: " + (rx.date || new Date().toISOString().slice(0, 10)), ""
        ];
        var meds = rx.meds || [];
        if (!meds.length) lines.push("No medicines recorded.");
        meds.forEach(function (m, i) {
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
        else if (doc && doc.statedPatientId && norm(doc.statedPatientId) !== norm(patient.id) && norm(doc.statedPatientId) !== norm(patient.name)) {
            add("warning", "pt-mismatch", "Patient mismatch", "Transcript mentions \"" + doc.statedPatientId + "\" but the selected patient is " + patient.name + " (" + patient.id + ").", "patient", findSnippet(transcript, doc.statedPatientId));
        }

        var s = (doc && doc.soap) || {};
        var subj = s.subjective || {};
        var obj = s.objective || {};
        var assess = s.assessment || {};
        var pl = s.plan || {};

        var cc = String(subj.chiefComplaint || "").trim();
        var exam = String(obj.examination || "").trim();
        var asmt = String(assess.assessment || "").trim();
        var trt = String(pl.treatment || "").trim();
        var inv = String(pl.investigations || "").trim();
        var fu = String(pl.followUp || "").trim();

        if (!cc) add("error", "cc-missing", "Missing required field: chief complaint", "No chief complaint could be identified in the transcript.", "subjective.chiefComplaint");
        if (!exam) add("info", "exam-missing", "Examination findings not provided", "Left blank. Nothing was inferred.", "objective.examination", findSnippet(transcript, "examination"));
        if (!asmt) add("warning", "assess-missing", "No clinician-stated assessment", "Awaiting clinician input. The system does not make diagnoses.", "assessment.assessment", findSnippet(transcript, "assessment"));
        if (!trt && !inv) add("warning", "plan-missing", "No plan stated", "Awaiting clinician input.", "plan.treatment", findSnippet(transcript, "plan"));
        if (!fu) add("info", "fu-missing", "Follow-up not stated", "", "plan.followUp");
        if (!doc || !doc.allergiesStated) add("info", "allergy-unknown", "Allergy status not stated", "No allergy information was found in the transcript.", "subjective.history");

        var rx = (doc && doc.prescription) || { meds: [] };
        (rx.meds || []).forEach(function (m, idx) {
            var label = "Medicine " + (idx + 1) + (m.name ? " (" + m.name + ")" : "");
            var f = function (k) { return "med." + m.id + "." + k; };
            if (!String(m.name || "").trim()) { add("error", "med-name-" + m.id, label + ": name missing", "Medicine name is required.", f("name")); return; }
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
        docFromExtraction: docFromExtraction, emptyDoc: emptyDoc, validateDocument: validateDocument,
        buildSummary: buildSummary, buildSoapText: buildSoapText, buildRxText: buildRxText,
        findSnippet: findSnippet, splitSentences: splitSentences, newId: newId, MED_FIELDS: MED_FIELDS,
        isQuestion: isQuestion
    };
});
