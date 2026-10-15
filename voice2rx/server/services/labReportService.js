"use strict";
/**
 * ClinicOS Laboratory Reports & Multi-Report Comparison Service
 * Provides:
 * - Patient-scoped lab report storage and retrieval
 * - Intelligent automated lab parameter parser (deterministic + reference ranges)
 * - Multi-report chronological comparison engine with trend analysis, deltas, and trajectory
 * - Clinical AI comparison summary generation
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../data");
const LAB_REPORTS_FILE = path.join(DATA_DIR, "lab_reports.json");

// Standard Clinical Reference Database for common laboratory tests
const LAB_CATALOG = {
    // Hematology / CBC
    "Hemoglobin (Hgb)": { category: "Hematology", unit: "g/dL", min: 13.5, max: 17.5, femaleMin: 12.0, femaleMax: 15.5, aliases: ["hemoglobin", "hgb", "hb"] },
    "White Blood Cell Count (WBC)": { category: "Hematology", unit: "x10^3/uL", min: 4.5, max: 11.0, aliases: ["wbc", "white blood cells", "total leukocyte count", "tlc"] },
    "Red Blood Cell Count (RBC)": { category: "Hematology", unit: "x10^6/uL", min: 4.30, max: 5.90, aliases: ["rbc", "red blood cells"] },
    "Hematocrit (Hct)": { category: "Hematology", unit: "%", min: 41.0, max: 50.0, aliases: ["hematocrit", "hct", "pcv"] },
    "Platelet Count": { category: "Hematology", unit: "x10^3/uL", min: 150, max: 450, aliases: ["platelets", "platelet count", "plt"] },
    "Mean Corpuscular Volume (MCV)": { category: "Hematology", unit: "fL", min: 80.0, max: 100.0, aliases: ["mcv"] },
    "Mean Corpuscular Hgb (MCH)": { category: "Hematology", unit: "pg", min: 27.0, max: 33.0, aliases: ["mch"] },
    "Neutrophils": { category: "Hematology", unit: "%", min: 40.0, max: 70.0, aliases: ["neutrophils", "neutrophil", "segs"] },
    "Lymphocytes": { category: "Hematology", unit: "%", min: 20.0, max: 40.0, aliases: ["lymphocytes", "lymphocyte", "lymphs"] },
    "Eosinophils": { category: "Hematology", unit: "%", min: 1.0, max: 4.0, aliases: ["eosinophils", "eosinophil", "eos"] },
    "Monocytes": { category: "Hematology", unit: "%", min: 2.0, max: 8.0, aliases: ["monocytes", "monocyte", "monos"] },
    "ESR (Erythrocyte Sed. Rate)": { category: "Hematology", unit: "mm/hr", min: 0, max: 20, aliases: ["esr", "erythrocyte sedimentation rate"] },

    // Biochemistry / Glycemic
    "Fasting Blood Glucose": { category: "Diabetic / Glycemic", unit: "mg/dL", min: 70, max: 99, aliases: ["fbg", "fasting blood glucose", "fasting glucose", "fbs", "fasting blood sugar"] },
    "Postprandial Glucose (PP)": { category: "Diabetic / Glycemic", unit: "mg/dL", min: 70, max: 140, aliases: ["ppbs", "postprandial glucose", "post-prandial blood sugar", "pp glucose"] },
    "HbA1c (Glycated Hemoglobin)": { category: "Diabetic / Glycemic", unit: "%", min: 4.0, max: 5.6, aliases: ["hba1c", "hemoglobin a1c", "glycated hemoglobin", "a1c"] },

    // Lipid Profile
    "Total Cholesterol": { category: "Lipid Profile", unit: "mg/dL", min: 125, max: 200, aliases: ["total_cholesterol", "total cholesterol", "cholesterol", "serum cholesterol"] },
    "LDL Cholesterol": { category: "Lipid Profile", unit: "mg/dL", min: 0, max: 100, aliases: ["ldl", "ldl cholesterol", "bad cholesterol"] },
    "HDL Cholesterol": { category: "Lipid Profile", unit: "mg/dL", min: 40, max: 60, aliases: ["hdl", "hdl cholesterol", "good cholesterol"] },
    "Triglycerides": { category: "Lipid Profile", unit: "mg/dL", min: 0, max: 150, aliases: ["triglycerides", "tg", "serum triglycerides"] },
    "VLDL Cholesterol": { category: "Lipid Profile", unit: "mg/dL", min: 5, max: 30, aliases: ["vldl", "vldl cholesterol"] },

    // Renal Function (KFT)
    "Serum Creatinine": { category: "Renal Function", unit: "mg/dL", min: 0.70, max: 1.30, femaleMin: 0.55, femaleMax: 1.05, aliases: ["creatinine", "serum creatinine", "creat"] },
    "Blood Urea Nitrogen (BUN)": { category: "Renal Function", unit: "mg/dL", min: 7.0, max: 20.0, aliases: ["blood urea nitrogen", "bun", "urea"] },
    "eGFR (Glomerular Filtration)": { category: "Renal Function", unit: "mL/min/1.73m²", min: 60, max: 120, aliases: ["egfr", "gfr", "estimated gfr"] },
    "Uric Acid": { category: "Renal Function", unit: "mg/dL", min: 3.5, max: 7.2, aliases: ["uric acid", "serum uric acid"] },

    // Liver Function (LFT)
    "ALT (SGPT)": { category: "Liver Function", unit: "U/L", min: 7, max: 56, aliases: ["alt", "sgpt", "alanine aminotransferase"] },
    "AST (SGOT)": { category: "Liver Function", unit: "U/L", min: 10, max: 40, aliases: ["ast", "sgot", "aspartate aminotransferase"] },
    "Alkaline Phosphatase (ALP)": { category: "Liver Function", unit: "U/L", min: 44, max: 147, aliases: ["alkaline phosphatase", "alp"] },
    "Total Bilirubin": { category: "Liver Function", unit: "mg/dL", min: 0.2, max: 1.2, aliases: ["total bilirubin", "t. bilirubin", "bilirubin total"] },
    "Serum Albumin": { category: "Liver Function", unit: "g/dL", min: 3.5, max: 5.5, aliases: ["albumin", "serum albumin"] },

    // Thyroid & Endocrine
    "TSH (Thyroid Stimulating Hormone)": { category: "Thyroid & Endocrine", unit: "uIU/mL", min: 0.40, max: 4.20, aliases: ["tsh", "thyroid stimulating hormone", "serum tsh"] },
    "Free T4 (Thyroxine)": { category: "Thyroid & Endocrine", unit: "ng/dL", min: 0.8, max: 1.8, aliases: ["free t4", "ft4", "free thyroxine"] },
    "Serum Ferritin": { category: "Vitamins & Minerals", unit: "ng/mL", min: 20, max: 250, aliases: ["ferritin", "serum ferritin"] },
    "Vitamin D (25-OH)": { category: "Vitamins & Minerals", unit: "ng/mL", min: 30, max: 100, aliases: ["vitamin d", "25-hydroxy vitamin d", "vit d"] },
    "Vitamin B12": { category: "Vitamins & Minerals", unit: "pg/mL", min: 200, max: 900, aliases: ["vitamin b12", "b12", "cyanocobalamin"] },
    "hs-CRP (C-Reactive Protein)": { category: "Inflammatory Markers", unit: "mg/L", min: 0.0, max: 3.0, aliases: ["crp", "hs-crp", "c-reactive protein"] }
};

let reportsCache = null;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadReports() {
    if (reportsCache) return reportsCache;
    ensureDataDir();
    if (fs.existsSync(LAB_REPORTS_FILE)) {
        try {
            reportsCache = JSON.parse(fs.readFileSync(LAB_REPORTS_FILE, "utf8"));
            if (Array.isArray(reportsCache) && reportsCache.length > 0) return reportsCache;
        } catch (e) {
            console.error("Failed to parse lab_reports.json, reseeding:", e);
        }
    }
    // Seed initial dataset
    reportsCache = seedInitialReports();
    saveReports(reportsCache);
    return reportsCache;
}

function saveReports(reports) {
    ensureDataDir();
    reportsCache = reports;
    fs.writeFileSync(LAB_REPORTS_FILE, JSON.stringify(reports, null, 2), "utf8");
}

function determineStatus(value, min, max) {
    if (typeof value !== "number" || isNaN(value)) return "NORMAL";
    if (min !== undefined && min !== null && value < min) {
        if (min > 0 && value < min * 0.7) return "CRITICAL";
        return "LOW";
    }
    if (max !== undefined && max !== null && value > max) {
        if (value > max * 1.5) return "CRITICAL";
        return "HIGH";
    }
    return "NORMAL";
}

/**
 * Intelligent text parser for laboratory reports.
 * Extracts individual tests, values, units, reference intervals, and status.
 */
function parseLabText(rawText) {
    if (!rawText || typeof rawText !== "string") return [];
    const lines = rawText.split(/\r?\n/);
    const results = [];
    const seenTests = new Set();

    lines.forEach((line) => {
        const cleanLine = line.trim();
        if (!cleanLine || cleanLine.length < 4) return;

        // Try matching against our catalog first
        let matched = false;
        for (const [canonicalName, meta] of Object.entries(LAB_CATALOG)) {
            const aliasPatterns = [canonicalName, ...meta.aliases].map((a) => a.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
            const regex = new RegExp(`(?:^|\\b)(${aliasPatterns.join("|")})\\b[\\s:=-]+([0-9]+(?:\\.[0-9]+)?)\\s*([A-Za-z/%^0-9²³µuL]+)?(?:\\s*\\(?(?:ref:?|reference:?)?\\s*([0-9.]+)?\\s*[-–—to ]+\\s*([0-9.]+)?\\s*([A-Za-z/%^0-9²³µuL]+)?\\)?)?`, "i");
            const match = cleanLine.match(regex);

            if (match && !seenTests.has(canonicalName.toLowerCase())) {
                const val = parseFloat(match[2]);
                let min = meta.min;
                let max = meta.max;
                if (match[4] && match[5]) {
                    const parsedMin = parseFloat(match[4]);
                    const parsedMax = parseFloat(match[5]);
                    if (!isNaN(parsedMin)) min = parsedMin;
                    if (!isNaN(parsedMax)) max = parsedMax;
                }
                const unit = match[3] || meta.unit;
                const status = determineStatus(val, min, max);
                const key = meta.aliases[0] || canonicalName.toLowerCase().replace(/[^a-z0-9]/g, "_");

                results.push({
                    key: key,
                    name: canonicalName,
                    category: meta.category,
                    value: val,
                    unit: unit,
                    min: min,
                    max: max,
                    status: status,
                    sourceLine: cleanLine
                });
                seenTests.add(canonicalName.toLowerCase());
                matched = true;
                break;
            }
        }
        if (matched) return;

        // Generic tabular or key: value parser for uncataloged tests
        if (!cleanLine.includes("Patient") && !cleanLine.includes("Doctor") && !cleanLine.includes("HOSPITAL") && !cleanLine.includes("LABORATORY")) {
            const genericMatch = cleanLine.match(/^([A-Za-z0-9\s()_-]{3,35})[:\t]\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z/%^0-9²³µuL]+)?(?:\s*\(?(?:ref:?|reference:?)?\s*([0-9.]+)?\s*[-–—to ]+\s*([0-9.]+)?\)?)?/i);
            if (genericMatch) {
                const testName = genericMatch[1].trim();
                if (!seenTests.has(testName.toLowerCase()) && !/^(date|age|page|time|room|bed|ref|mrn|dob|phone)/i.test(testName)) {
                    const val = parseFloat(genericMatch[2]);
                    let min = genericMatch[4] ? parseFloat(genericMatch[4]) : undefined;
                    let max = genericMatch[5] ? parseFloat(genericMatch[5]) : undefined;
                    const status = determineStatus(val, min, max);
                    results.push({
                        key: testName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
                        name: testName,
                        category: "General Lab",
                        value: val,
                        unit: genericMatch[3] || "",
                        min: min,
                        max: max,
                        status: status,
                        sourceLine: cleanLine
                    });
                    seenTests.add(testName.toLowerCase());
                }
            }
        }
    });

    return results;
}

/**
 * Multi-Report Chronological Comparison Engine
 * Compares any number of reports for a patient across all shared parameters.
 */
function compareReports(patientId, reportIds) {
    const all = loadReports().filter((r) => String(r.patientId) === String(patientId));
    let selected = [];

    if (!reportIds || !reportIds.length || reportIds === "all") {
        selected = all.slice();
    } else {
        const idSet = new Set(reportIds.map(String));
        selected = all.filter((r) => idSet.has(String(r.id)));
    }

    // Sort chronologically ascending (oldest to newest)
    selected.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    if (selected.length === 0) {
        return {
            patientId,
            reportsCount: 0,
            reportHeaders: [],
            parameters: [],
            summary: "No laboratory reports found for comparison."
        };
    }

    const reportHeaders = selected.map((r) => ({
        id: r.id,
        date: r.date,
        title: r.title,
        facility: r.facility || "Clinical Laboratory",
        category: r.category || "General Panel"
    }));

    // Collect all parameters
    const paramMap = new Map();

    selected.forEach((report, reportIndex) => {
        (report.tests || []).forEach((test) => {
            let canonicalName = test.name;
            let meta = LAB_CATALOG[test.name];
            let paramKey = test.key;

            if (!meta) {
                // Find in catalog by alias or key
                const match = Object.entries(LAB_CATALOG).find(([cName, cMeta]) => {
                    const aliases = [cName, ...cMeta.aliases].map((a) => a.toLowerCase());
                    return aliases.includes(test.name.toLowerCase()) || (test.key && aliases.includes(test.key.toLowerCase()));
                });
                if (match) {
                    canonicalName = match[0];
                    meta = match[1];
                }
            }

            if (!paramKey && meta && meta.aliases) {
                paramKey = meta.aliases[0];
            }
            if (!paramKey) {
                paramKey = canonicalName.toLowerCase().replace(/[^a-z0-9]/g, "_");
            }

            const mapKey = canonicalName.toLowerCase();
            if (!paramMap.has(mapKey)) {
                paramMap.set(mapKey, {
                    key: paramKey,
                    name: canonicalName,
                    category: (meta && meta.category) || test.category || "Other",
                    unit: (meta && meta.unit) || test.unit || "",
                    min: (meta && meta.min != null) ? meta.min : test.min,
                    max: (meta && meta.max != null) ? meta.max : test.max,
                    values: new Array(selected.length).fill(null),
                    statuses: new Array(selected.length).fill(null)
                });
            }
            const item = paramMap.get(mapKey);
            item.values[reportIndex] = test.value;
            item.statuses[reportIndex] = test.status || determineStatus(test.value, item.min, item.max);
            if (!item.unit && test.unit) item.unit = test.unit;
            if (item.min == null && test.min != null) item.min = test.min;
            if (item.max == null && test.max != null) item.max = test.max;
        });
    });

    // Compute trends and metrics for each parameter
    const parameters = Array.from(paramMap.values()).map((p) => {
        const nonNullValues = p.values.filter((v) => v !== null);
        const firstVal = nonNullValues[0];
        const lastVal = nonNullValues[nonNullValues.length - 1];
        let delta = null;
        let deltaPct = null;
        let direction = "stable"; // "up" | "down" | "stable"
        let trajectory = "stable_normal"; // "improved" | "worsened" | "stable_normal" | "stable_abnormal"

        if (nonNullValues.length > 1 && typeof firstVal === "number" && typeof lastVal === "number") {
            delta = Math.round((lastVal - firstVal) * 100) / 100;
            if (firstVal !== 0) {
                deltaPct = Math.round(((lastVal - firstVal) / firstVal) * 1000) / 10;
            }
            if (Math.abs(delta) < 0.05 * (firstVal || 1)) {
                direction = "stable";
            } else {
                direction = delta > 0 ? "up" : "down";
            }

            const firstStatus = p.statuses.find((s) => s !== null);
            const lastStatus = p.statuses.slice().reverse().find((s) => s !== null);

            // Clinical interpretation of direction
            const isAbnormalFirst = firstStatus && firstStatus !== "NORMAL";
            const isAbnormalLast = lastStatus && lastStatus !== "NORMAL";

            if (isAbnormalFirst && !isAbnormalLast) {
                trajectory = "improved"; // Normalized!
            } else if (!isAbnormalFirst && isAbnormalLast) {
                trajectory = "worsened"; // Became abnormal
            } else if (isAbnormalFirst && isAbnormalLast) {
                // Check if moving towards or away from normal
                if (p.max && firstVal > p.max && lastVal < firstVal) trajectory = "improved";
                else if (p.min && firstVal < p.min && lastVal > firstVal) trajectory = "improved";
                else if (p.max && firstVal > p.max && lastVal > firstVal) trajectory = "worsened";
                else if (p.min && firstVal < p.min && lastVal < firstVal) trajectory = "worsened";
                else trajectory = "stable_abnormal";
            } else {
                trajectory = "stable_normal";
            }
        }

        return {
            key: p.key,
            name: p.name,
            category: p.category,
            unit: p.unit,
            referenceRange: p.min != null && p.max != null ? `${p.min} - ${p.max} ${p.unit}`.trim() : (p.unit ? `Ref (${p.unit})` : "—"),
            min: p.min,
            max: p.max,
            values: nonNullValues,
            latestValue: lastVal,
            history: p.values.map((val, idx) => ({
                reportId: selected[idx].id,
                date: selected[idx].date,
                value: val,
                status: p.statuses[idx]
            })),
            delta,
            deltaPct,
            direction: direction === "down" ? "falling" : direction === "up" ? "rising" : "stable",
            directionCode: direction,
            trajectory,
            currentValue: lastVal,
            currentStatus: p.statuses.slice().reverse().find((s) => s !== null) || "NORMAL"
        };
    });

    // Sort parameters: Abnormal first, then by category, then by name
    parameters.sort((a, b) => {
        const aAbn = a.currentStatus !== "NORMAL" ? 0 : 1;
        const bAbn = b.currentStatus !== "NORMAL" ? 0 : 1;
        if (aAbn !== bAbn) return aAbn - bAbn;
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
    });

    // Generate clinical comparison summary narrative
    const narrative = generateComparisonNarrative(selected, parameters);

    return {
        patientId,
        reportsCount: selected.length,
        reports: reportHeaders,
        reportHeaders,
        parameters,
        summary: narrative,
        narrative
    };
}

function generateComparisonNarrative(reports, parameters) {
    if (reports.length < 2) {
        const latest = reports[0];
        const abnormals = parameters.filter((p) => p.currentStatus !== "NORMAL");
        if (!abnormals.length) return `Baseline laboratory report from ${latest.date}. All evaluated parameters fall within standard reference intervals.`;
        return `Single baseline report from ${latest.date}. Flagged values requiring review: ${abnormals.map((p) => `${p.name} (${p.currentValue} ${p.unit} - ${p.currentStatus})`).join("; ")}.`;
    }

    const first = reports[0];
    const latest = reports[reports.length - 1];
    const improved = parameters.filter((p) => p.trajectory === "improved");
    const worsened = parameters.filter((p) => p.trajectory === "worsened");
    const persistentAbnormal = parameters.filter((p) => p.trajectory === "stable_abnormal");
    const currentNormal = parameters.filter((p) => p.currentStatus === "NORMAL");

    const lines = [];
    lines.push(`COMPARATIVE LABORATORY TRAJECTORY (${first.date} → ${latest.date} across ${reports.length} reports):`);

    if (improved.length) {
        lines.push(`• Clinically Improved Parameters: ${improved.map((p) => `${p.name} (${p.history[0].value} → ${p.currentValue} ${p.unit}, ${p.delta > 0 ? "+" : ""}${p.delta} ${p.unit})`).join("; ")}.`);
    }

    if (worsened.length) {
        lines.push(`• Values Requiring Clinical Attention: ${worsened.map((p) => `${p.name} (${p.history[0].value} → ${p.currentValue} ${p.unit} [${p.currentStatus}])`).join("; ")}.`);
    }

    if (persistentAbnormal.length) {
        lines.push(`• Ongoing Deviations: ${persistentAbnormal.map((p) => `${p.name} remaining ${p.currentStatus.toLowerCase()} (${p.currentValue} ${p.unit})`).join("; ")}.`);
    }

    if (currentNormal.length && !improved.length && !worsened.length && !persistentAbnormal.length) {
        lines.push(`• All measured biochemical, hematological, and metabolic markers have demonstrated consistent stability within standard biological reference ranges.`);
    }

    lines.push(`• Clinical Impression: Laboratory trajectory indicates ${improved.length ? "favorable therapeutic response with measurable biological improvement" : "stable clinical metrics"}. ${worsened.length ? "Recommend targeted follow-up on flagged markers." : "Continue current management strategy."}`);

    return lines.join("\n");
}

function seedInitialReports() {
    return [
        // Arthur Pendelton (PAT-2001) - 3 chronological reports
        {
            id: "lab-pat2001-01",
            patientId: "PAT-2001",
            patientName: "Arthur Pendelton",
            date: "2026-02-12",
            title: "Baseline Comprehensive Metabolic & Lipid Panel",
            facility: "St. Jude Metropolitan Hospital",
            category: "Biochemistry & Lipids",
            notes: "Initial annual wellness screening. Fasting 12h.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 13.4, unit: "g/dL", min: 13.5, max: 17.5, status: "LOW" },
                { name: "White Blood Cell Count (WBC)", category: "Hematology", value: 7.2, unit: "x10^3/uL", min: 4.5, max: 11.0, status: "NORMAL" },
                { name: "Platelet Count", category: "Hematology", value: 230, unit: "x10^3/uL", min: 150, max: 450, status: "NORMAL" },
                { name: "Fasting Blood Glucose", category: "Diabetic / Glycemic", value: 126, unit: "mg/dL", min: 70, max: 99, status: "HIGH" },
                { name: "HbA1c (Glycated Hemoglobin)", category: "Diabetic / Glycemic", value: 6.8, unit: "%", min: 4.0, max: 5.6, status: "HIGH" },
                { name: "Total Cholesterol", category: "Lipid Profile", value: 242, unit: "mg/dL", min: 125, max: 200, status: "HIGH" },
                { name: "LDL Cholesterol", category: "Lipid Profile", value: 158, unit: "mg/dL", min: 0, max: 100, status: "HIGH" },
                { name: "HDL Cholesterol", category: "Lipid Profile", value: 41, unit: "mg/dL", min: 40, max: 60, status: "NORMAL" },
                { name: "Triglycerides", category: "Lipid Profile", value: 215, unit: "mg/dL", min: 0, max: 150, status: "HIGH" },
                { name: "Serum Creatinine", category: "Renal Function", value: 1.05, unit: "mg/dL", min: 0.70, max: 1.30, status: "NORMAL" },
                { name: "eGFR (Glomerular Filtration)", category: "Renal Function", value: 78, unit: "mL/min/1.73m²", min: 60, max: 120, status: "NORMAL" },
                { name: "ALT (SGPT)", category: "Liver Function", value: 42, unit: "U/L", min: 7, max: 56, status: "NORMAL" }
            ]
        },
        {
            id: "lab-pat2001-02",
            patientId: "PAT-2001",
            patientName: "Arthur Pendelton",
            date: "2026-05-18",
            title: "3-Month Post-Statin & Dietary Monitoring",
            facility: "St. Jude Metropolitan Hospital",
            category: "Biochemistry & Lipids",
            notes: "Evaluating response to dietary modification and Atorvastatin 20mg.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 14.1, unit: "g/dL", min: 13.5, max: 17.5, status: "NORMAL" },
                { name: "White Blood Cell Count (WBC)", category: "Hematology", value: 6.9, unit: "x10^3/uL", min: 4.5, max: 11.0, status: "NORMAL" },
                { name: "Platelet Count", category: "Hematology", value: 240, unit: "x10^3/uL", min: 150, max: 450, status: "NORMAL" },
                { name: "Fasting Blood Glucose", category: "Diabetic / Glycemic", value: 112, unit: "mg/dL", min: 70, max: 99, status: "HIGH" },
                { name: "HbA1c (Glycated Hemoglobin)", category: "Diabetic / Glycemic", value: 6.3, unit: "%", min: 4.0, max: 5.6, status: "HIGH" },
                { name: "Total Cholesterol", category: "Lipid Profile", value: 210, unit: "mg/dL", min: 125, max: 200, status: "HIGH" },
                { name: "LDL Cholesterol", category: "Lipid Profile", value: 132, unit: "mg/dL", min: 0, max: 100, status: "HIGH" },
                { name: "HDL Cholesterol", category: "Lipid Profile", value: 46, unit: "mg/dL", min: 40, max: 60, status: "NORMAL" },
                { name: "Triglycerides", category: "Lipid Profile", value: 168, unit: "mg/dL", min: 0, max: 150, status: "HIGH" },
                { name: "Serum Creatinine", category: "Renal Function", value: 0.98, unit: "mg/dL", min: 0.70, max: 1.30, status: "NORMAL" },
                { name: "eGFR (Glomerular Filtration)", category: "Renal Function", value: 84, unit: "mL/min/1.73m²", min: 60, max: 120, status: "NORMAL" },
                { name: "ALT (SGPT)", category: "Liver Function", value: 36, unit: "U/L", min: 7, max: 56, status: "NORMAL" }
            ]
        },
        {
            id: "lab-pat2001-03",
            patientId: "PAT-2001",
            patientName: "Arthur Pendelton",
            date: "2026-08-14",
            title: "Routine Complete Blood Count & Follow-up Panel",
            facility: "St. Jude Metropolitan Hospital",
            category: "Hematology & Metabolism",
            notes: "Substantial normalization of metabolic parameters noted.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 15.2, unit: "g/dL", min: 13.5, max: 17.5, status: "NORMAL" },
                { name: "White Blood Cell Count (WBC)", category: "Hematology", value: 6.8, unit: "x10^3/uL", min: 4.5, max: 11.0, status: "NORMAL" },
                { name: "Hematocrit (Hct)", category: "Hematology", value: 44.8, unit: "%", min: 41.0, max: 50.0, status: "NORMAL" },
                { name: "Platelet Count", category: "Hematology", value: 245, unit: "x10^3/uL", min: 150, max: 450, status: "NORMAL" },
                { name: "Eosinophils", category: "Hematology", value: 4.2, unit: "%", min: 1.0, max: 4.0, status: "HIGH" },
                { name: "Fasting Blood Glucose", category: "Diabetic / Glycemic", value: 98, unit: "mg/dL", min: 70, max: 99, status: "NORMAL" },
                { name: "HbA1c (Glycated Hemoglobin)", category: "Diabetic / Glycemic", value: 5.7, unit: "%", min: 4.0, max: 5.6, status: "HIGH" },
                { name: "Total Cholesterol", category: "Lipid Profile", value: 188, unit: "mg/dL", min: 125, max: 200, status: "NORMAL" },
                { name: "LDL Cholesterol", category: "Lipid Profile", value: 104, unit: "mg/dL", min: 0, max: 100, status: "HIGH" },
                { name: "HDL Cholesterol", category: "Lipid Profile", value: 52, unit: "mg/dL", min: 40, max: 60, status: "NORMAL" },
                { name: "Triglycerides", category: "Lipid Profile", value: 138, unit: "mg/dL", min: 0, max: 150, status: "NORMAL" },
                { name: "Serum Creatinine", category: "Renal Function", value: 0.95, unit: "mg/dL", min: 0.70, max: 1.30, status: "NORMAL" },
                { name: "eGFR (Glomerular Filtration)", category: "Renal Function", value: 88, unit: "mL/min/1.73m²", min: 60, max: 120, status: "NORMAL" },
                { name: "ALT (SGPT)", category: "Liver Function", value: 31, unit: "U/L", min: 7, max: 56, status: "NORMAL" }
            ]
        },

        // Rahul Sharma (PT-1001) - 2 chronological reports
        {
            id: "lab-pt1001-01",
            patientId: "PT-1001",
            patientName: "Rahul Sharma",
            date: "2026-06-20",
            title: "Acute Febrile Workup & Hepatic Panel",
            facility: "Apollo Diagnostics",
            category: "Hematology & Hepatic",
            notes: "Evaluation for viral fever with lethargy.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 14.2, unit: "g/dL", min: 13.5, max: 17.5, status: "NORMAL" },
                { name: "White Blood Cell Count (WBC)", category: "Hematology", value: 13.4, unit: "x10^3/uL", min: 4.5, max: 11.0, status: "HIGH" },
                { name: "Platelet Count", category: "Hematology", value: 135, unit: "x10^3/uL", min: 150, max: 450, status: "LOW" },
                { name: "ALT (SGPT)", category: "Liver Function", value: 72, unit: "U/L", min: 7, max: 56, status: "HIGH" },
                { name: "AST (SGOT)", category: "Liver Function", value: 58, unit: "U/L", min: 10, max: 40, status: "HIGH" },
                { name: "Total Bilirubin", category: "Liver Function", value: 1.4, unit: "mg/dL", min: 0.2, max: 1.2, status: "HIGH" },
                { name: "Serum Creatinine", category: "Renal Function", value: 0.92, unit: "mg/dL", min: 0.70, max: 1.30, status: "NORMAL" }
            ]
        },
        {
            id: "lab-pt1001-02",
            patientId: "PT-1001",
            patientName: "Rahul Sharma",
            date: "2026-08-05",
            title: "Post-Infection Recovery Follow-up",
            facility: "Apollo Diagnostics",
            category: "Hematology & Hepatic",
            notes: "Complete resolution of acute transaminitis and thrombocytopenia.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 14.6, unit: "g/dL", min: 13.5, max: 17.5, status: "NORMAL" },
                { name: "White Blood Cell Count (WBC)", category: "Hematology", value: 6.8, unit: "x10^3/uL", min: 4.5, max: 11.0, status: "NORMAL" },
                { name: "Platelet Count", category: "Hematology", value: 235, unit: "x10^3/uL", min: 150, max: 450, status: "NORMAL" },
                { name: "ALT (SGPT)", category: "Liver Function", value: 28, unit: "U/L", min: 7, max: 56, status: "NORMAL" },
                { name: "AST (SGOT)", category: "Liver Function", value: 22, unit: "U/L", min: 10, max: 40, status: "NORMAL" },
                { name: "Total Bilirubin", category: "Liver Function", value: 0.8, unit: "mg/dL", min: 0.2, max: 1.2, status: "NORMAL" },
                { name: "Serum Creatinine", category: "Renal Function", value: 0.88, unit: "mg/dL", min: 0.70, max: 1.30, status: "NORMAL" }
            ]
        },

        // Priya Kumar (PT-1002) - 2 chronological reports
        {
            id: "lab-pt1002-01",
            patientId: "PT-1002",
            patientName: "Priya Kumar",
            date: "2026-04-12",
            title: "Fatigue Investigation & Thyroid Profile",
            facility: "City Care Clinical Lab",
            category: "Hematology & Endocrine",
            notes: "Severe chronic fatigue and cold intolerance.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 9.6, unit: "g/dL", min: 12.0, max: 15.5, status: "LOW" },
                { name: "Hematocrit (Hct)", category: "Hematology", value: 31.0, unit: "%", min: 36.0, max: 48.0, status: "LOW" },
                { name: "Mean Corpuscular Volume (MCV)", category: "Hematology", value: 72.0, unit: "fL", min: 80.0, max: 100.0, status: "LOW" },
                { name: "Serum Ferritin", category: "Vitamins & Minerals", value: 8.5, unit: "ng/mL", min: 20, max: 250, status: "LOW" },
                { name: "TSH (Thyroid Stimulating Hormone)", category: "Thyroid & Endocrine", value: 4.85, unit: "uIU/mL", min: 0.40, max: 4.20, status: "HIGH" },
                { name: "Free T4 (Thyroxine)", category: "Thyroid & Endocrine", value: 0.95, unit: "ng/dL", min: 0.8, max: 1.8, status: "NORMAL" },
                { name: "Vitamin D (25-OH)", category: "Vitamins & Minerals", value: 18.2, unit: "ng/mL", min: 30, max: 100, status: "LOW" }
            ]
        },
        {
            id: "lab-pt1002-02",
            patientId: "PT-1002",
            patientName: "Priya Kumar",
            date: "2026-08-01",
            title: "Post-Iron & Vitamin D Supplementation Follow-up",
            facility: "City Care Clinical Lab",
            category: "Hematology & Endocrine",
            notes: "Significant symptomatic improvement. Energy returned.",
            tests: [
                { name: "Hemoglobin (Hgb)", category: "Hematology", value: 12.8, unit: "g/dL", min: 12.0, max: 15.5, status: "NORMAL" },
                { name: "Hematocrit (Hct)", category: "Hematology", value: 38.5, unit: "%", min: 36.0, max: 48.0, status: "NORMAL" },
                { name: "Mean Corpuscular Volume (MCV)", category: "Hematology", value: 84.5, unit: "fL", min: 80.0, max: 100.0, status: "NORMAL" },
                { name: "Serum Ferritin", category: "Vitamins & Minerals", value: 42.0, unit: "ng/mL", min: 20, max: 250, status: "NORMAL" },
                { name: "TSH (Thyroid Stimulating Hormone)", category: "Thyroid & Endocrine", value: 2.45, unit: "uIU/mL", min: 0.40, max: 4.20, status: "NORMAL" },
                { name: "Free T4 (Thyroxine)", category: "Thyroid & Endocrine", value: 1.25, unit: "ng/dL", min: 0.8, max: 1.8, status: "NORMAL" },
                { name: "Vitamin D (25-OH)", category: "Vitamins & Minerals", value: 44.0, unit: "ng/mL", min: 30, max: 100, status: "NORMAL" }
            ]
        }
    ];
}

module.exports = {
    loadReports,
    saveReports,
    getPatientReports: (patientId) => {
        const reports = loadReports().filter((r) => String(r.patientId) === String(patientId));
        return reports.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    },
    getReport: (id) => loadReports().find((r) => String(r.id) === String(id)) || null,
    uploadLabReport: (patientId, payload) => {
        const reports = loadReports();
        const id = "lab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
        let parsedTests = Array.isArray(payload.tests) && payload.tests.length ? payload.tests : [];
        if (!parsedTests.length && payload.rawText) {
            parsedTests = parseLabText(payload.rawText);
        }
        // Ensure status is evaluated
        parsedTests = parsedTests.map((t) => {
            const min = t.min != null ? t.min : LAB_CATALOG[t.name]?.min;
            const max = t.max != null ? t.max : LAB_CATALOG[t.name]?.max;
            return {
                name: t.name,
                category: t.category || LAB_CATALOG[t.name]?.category || "General",
                value: typeof t.value === "number" ? t.value : parseFloat(t.value) || 0,
                unit: t.unit || LAB_CATALOG[t.name]?.unit || "",
                min: min,
                max: max,
                status: t.status || determineStatus(t.value, min, max)
            };
        });

        const newReport = {
            id,
            patientId: String(patientId),
            patientName: payload.patientName || "Patient " + patientId,
            date: payload.date || new Date().toISOString().slice(0, 10),
            title: payload.title || "Laboratory Report",
            facility: payload.facility || "Clinical Laboratory",
            category: payload.category || "General Diagnostics",
            notes: payload.notes || "",
            tests: parsedTests,
            rawText: payload.rawText || "",
            createdAt: new Date().toISOString()
        };

        reports.push(newReport);
        saveReports(reports);
        return newReport;
    },
    deleteReport: (id) => {
        const reports = loadReports();
        const idx = reports.findIndex((r) => String(r.id) === String(id));
        if (idx === -1) return false;
        reports.splice(idx, 1);
        saveReports(reports);
        return true;
    },
    parseLabText,
    compareReports,
    seedInitialReports,
    saveReports,
    LAB_CATALOG
};
