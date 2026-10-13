"use strict";
// Server-side validation of API inputs and of documents (reuses the shared deterministic rules).
const C = require("../../shared/clinical");

function validateTranscriptInput(body) {
    if (!body || typeof body.transcript !== "string") return "transcript (string) is required";
    if (body.transcript.trim().length === 0) return "transcript is empty";
    if (body.transcript.length > 100000) return "transcript is too long";
    return null;
}

function validateConsultationInput(body) {
    if (!body || typeof body !== "object") return "Body must be a JSON object";
    if (!body.patient || typeof body.patient.id !== "string" || !body.patient.id) return "patient.id is required";
    if (!["draft", "approved"].includes(body.status)) return "status must be 'draft' or 'approved'";
    if (typeof body.transcript !== "string") return "transcript must be a string";
    if (!body.doc || typeof body.doc !== "object" || !body.doc.soap || !body.doc.prescription || !Array.isArray(body.doc.prescription.meds)) return "doc.soap and doc.prescription.meds are required";
    if (body.status === "approved") {
        const issues = C.validateDocument(body.doc, body.transcript, body.patient, {});
        if (issues.some((i) => i.severity === "error")) return "Cannot approve while blocking validation errors remain";
    }
    return null;
}

module.exports = { validateTranscriptInput, validateConsultationInput, validateDocument: C.validateDocument };
