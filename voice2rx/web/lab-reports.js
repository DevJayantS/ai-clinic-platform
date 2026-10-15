/* ClinicOS Laboratory Reports & Multi-Report Comparison Workspace */
(function () {
    "use strict";

    var PATIENTS_LIST = [
        { id: "PAT-2001", name: "Arthur Pendelton", age: 54, gender: "Male" },
        { id: "PT-1001", name: "Rahul Sharma", age: 32, gender: "Male" },
        { id: "PT-1002", name: "Priya Kumar", age: 28, gender: "Female" },
        { id: "PT-1003", name: "Amit Singh", age: 45, gender: "Male" },
        { id: "PT-1004", name: "Neha Gupta", age: 39, gender: "Female" }
    ];

    var state = {
        activePatientId: "PAT-2001",
        reports: [],
        selectedReportIds: new Set(),
        comparison: null,
        activeCategory: "ALL",
        searchQuery: "",
        isLoading: false,
        uploadModalOpen: false,
        viewModalOpen: false,
        viewingReport: null,
        previewTests: []
    };

    var rootEl = null;

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function activePatient() {
        return PATIENTS_LIST.find(function (p) { return p.id === state.activePatientId; }) || {
            id: state.activePatientId,
            name: "Patient " + state.activePatientId,
            age: "—",
            gender: "—"
        };
    }

    // -----------------------------------------------------------------------
    // API Integration
    // -----------------------------------------------------------------------
    async function fetchReports(patientId) {
        state.isLoading = true;
        render();
        try {
            var res = await fetch("/api/patients/" + encodeURIComponent(patientId) + "/lab-reports");
            if (res.ok) {
                state.reports = await res.json();
            } else {
                state.reports = [];
            }
        } catch (e) {
            console.warn("Lab reports fetch fallback:", e);
            state.reports = [];
        }

        // Default: select all reports for comparison
        state.selectedReportIds = new Set(state.reports.map(function (r) { return r.id; }));
        await fetchComparison();
        state.isLoading = false;
        render();
    }

    async function fetchComparison() {
        if (!state.reports.length) {
            state.comparison = null;
            return;
        }
        var ids = Array.from(state.selectedReportIds);
        try {
            var res = await fetch("/api/patients/" + encodeURIComponent(state.activePatientId) + "/lab-reports/compare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportIds: ids.length ? ids : "all" })
            });
            if (res.ok) {
                state.comparison = await res.json();
            }
        } catch (e) {
            console.error("Comparison request failed:", e);
        }
    }

    async function uploadReport(payload) {
        try {
            var res = await fetch("/api/patients/" + encodeURIComponent(state.activePatientId) + "/lab-reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error("Upload failed: " + res.status);
            var data = await res.json();
            await fetchReports(state.activePatientId);
            showToast("Laboratory report uploaded and compared successfully!", "ok");
            return data;
        } catch (e) {
            showToast("Failed to upload report: " + e.message, "err");
            throw e;
        }
    }

    async function deleteReport(reportId) {
        if (!confirm("Are you sure you want to delete this laboratory report?")) return;
        try {
            var res = await fetch("/api/patients/" + encodeURIComponent(state.activePatientId) + "/lab-reports/" + encodeURIComponent(reportId), {
                method: "DELETE"
            });
            if (res.ok) {
                await fetchReports(state.activePatientId);
                showToast("Report deleted successfully.", "ok");
            }
        } catch (e) {
            showToast("Delete failed: " + e.message, "err");
        }
    }

    async function parseTextPreview(text) {
        try {
            var res = await fetch("/api/lab-reports/parse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rawText: text })
            });
            if (res.ok) {
                var data = await res.json();
                return Array.isArray(data) ? data : (data.tests || []);
            }
        } catch (e) {
            console.warn("Parse preview error:", e);
        }
        return [];
    }

    // -----------------------------------------------------------------------
    // Toast Notification
    // -----------------------------------------------------------------------
    function showToast(msg, type) {
        type = type || "ok";
        var el = document.createElement("div");
        el.className = "lab-toast " + type;
        el.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:12px;background:" + (type === "ok" ? "#10b981" : "#ef4444") + ";color:white;font-weight:600;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,0.18);animation:fadeIn 0.2s ease;";
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 4000);
    }

    // -----------------------------------------------------------------------
    // Sparkline SVG Generator
    // -----------------------------------------------------------------------
    function generateSparklineSvg(history) {
        var validPoints = history.filter(function (h) { return h.value != null; });
        if (validPoints.length < 2) return '<span style="color:#94a3b8;font-size:11px;">Single point</span>';

        var vals = validPoints.map(function (p) { return p.value; });
        var min = Math.min.apply(null, vals);
        var max = Math.max.apply(null, vals);
        var range = max - min;
        if (range === 0) range = 1;

        var width = 84;
        var height = 26;
        var padding = 4;

        var coords = validPoints.map(function (p, i) {
            var x = padding + (i / (validPoints.length - 1)) * (width - 2 * padding);
            var y = height - padding - ((p.value - min) / range) * (height - 2 * padding);
            return { x: x, y: y, val: p.value, status: p.status, date: p.date };
        });

        var pointsStr = coords.map(function (c) { return c.x.toFixed(1) + "," + c.y.toFixed(1); }).join(" ");
        var strokeColor = "#18aa91";
        if (coords[coords.length - 1].status === "HIGH") strokeColor = "#d97706";
        if (coords[coords.length - 1].status === "LOW") strokeColor = "#2563eb";
        if (coords[coords.length - 1].status === "CRITICAL") strokeColor = "#dc2626";

        var circles = coords.map(function (c) {
            return '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="2.8" fill="' + strokeColor + '"><title>' + esc(c.date + ": " + c.val) + '</title></circle>';
        }).join("");

        return '<svg class="lab-sparkline-svg" viewBox="0 0 ' + width + ' ' + height + '">' +
            '<polyline fill="none" stroke="' + strokeColor + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + pointsStr + '"/>' +
            circles +
            '</svg>';
    }

    // -----------------------------------------------------------------------
    // UI Rendering
    // -----------------------------------------------------------------------
    function render() {
        if (!rootEl) return;
        var pat = activePatient();
        var reports = state.reports;
        var comp = state.comparison;
        var selectedCount = state.selectedReportIds.size;

        var totalTestsCount = comp ? comp.parameters.length : 0;
        var abnormalTestsCount = comp ? comp.parameters.filter(function (p) { return p.currentStatus !== "NORMAL"; }).length : 0;
        var improvedCount = comp ? comp.parameters.filter(function (p) { return p.trajectory === "improved"; }).length : 0;

        // Categories available in current comparison
        var categories = ["ALL"];
        if (comp && comp.parameters) {
            comp.parameters.forEach(function (p) {
                if (p.category && categories.indexOf(p.category) === -1) categories.push(p.category);
            });
        }

        // Filtered parameters
        var filteredParams = (comp && comp.parameters) ? comp.parameters.filter(function (p) {
            if (state.activeCategory === "ABNORMAL" && p.currentStatus === "NORMAL") return false;
            if (state.activeCategory !== "ALL" && state.activeCategory !== "ABNORMAL" && p.category !== state.activeCategory) return false;
            if (state.searchQuery.trim()) {
                var q = state.searchQuery.toLowerCase();
                return p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q));
            }
            return true;
        }) : [];

        var html = [];

        html.push('<div class="lab-workspace">');

        // 1. Header & Patient Banner
        html.push('  <div class="lab-header">');
        html.push('    <div class="lab-header-left">');
        html.push('      <div class="lab-patient-avatar">' + esc(pat.name.charAt(0)) + '</div>');
        html.push('      <div class="lab-patient-info">');
        html.push('        <h2>' + esc(pat.name) + ' <span class="lab-badge lab-badge-teal">' + esc(pat.id) + '</span></h2>');
        html.push('        <p>' + esc(pat.gender) + ' &bull; Age ' + esc(pat.age) + ' &bull; ' + reports.length + ' reports documented</p>');
        html.push('      </div>');
        html.push('      <div class="lab-patient-selector">');
        html.push('        <span>Switch Patient:</span>');
        html.push('        <select id="labPatientSelect">');
        PATIENTS_LIST.forEach(function (p) {
            html.push('          <option value="' + esc(p.id) + '"' + (p.id === state.activePatientId ? " selected" : "") + '>' + esc(p.name) + ' (' + esc(p.id) + ')</option>');
        });
        html.push('        </select>');
        html.push('      </div>');
        html.push('    </div>');

        html.push('    <div class="lab-header-actions">');
        html.push('      <button class="lab-btn lab-btn-primary" id="btnOpenUploadModal">');
        html.push('        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>');
        html.push('        + Upload New Lab Report');
        html.push('      </button>');
        html.push('      <button class="lab-btn lab-btn-secondary" id="btnSampleReport">');
        html.push('        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>');
        html.push('        Quick Demo Sample');
        html.push('      </button>');
        html.push('      <button class="lab-btn lab-btn-outline" id="btnCopySoap">');
        html.push('        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>');
        html.push('        Copy Trend to SOAP Note');
        html.push('      </button>');
        html.push('      <button class="lab-btn lab-btn-secondary" id="btnPrintReport">');
        html.push('        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>');
        html.push('        Print');
        html.push('      </button>');
        html.push('    </div>');
        html.push('  </div>');

        // 2. Metrics Stats Row
        html.push('  <div class="lab-stats-row">');
        html.push('    <div class="lab-stat-box">');
        html.push('      <div class="lab-stat-icon teal">&#x2318;</div>');
        html.push('      <div class="lab-stat-details">');
        html.push('        <h3>' + reports.length + '</h3>');
        html.push('        <p>Total Lab Reports</p>');
        html.push('      </div>');
        html.push('    </div>');
        html.push('    <div class="lab-stat-box">');
        html.push('      <div class="lab-stat-icon blue">&#x229E;</div>');
        html.push('      <div class="lab-stat-details">');
        html.push('        <h3>' + totalTestsCount + '</h3>');
        html.push('        <p>Unique Parameters Monitored</p>');
        html.push('      </div>');
        html.push('    </div>');
        html.push('    <div class="lab-stat-box">');
        html.push('      <div class="lab-stat-icon ' + (abnormalTestsCount > 0 ? "amber" : "emerald") + '">&#x26A0;</div>');
        html.push('      <div class="lab-stat-details">');
        html.push('        <h3>' + abnormalTestsCount + '</h3>');
        html.push('        <p>Currently Flagged Abnormal</p>');
        html.push('      </div>');
        html.push('    </div>');
        html.push('    <div class="lab-stat-box">');
        html.push('      <div class="lab-stat-icon emerald">&#x2713;</div>');
        html.push('      <div class="lab-stat-details">');
        html.push('        <h3>' + improvedCount + '</h3>');
        html.push('        <p>Clinically Improved Metrics</p>');
        html.push('      </div>');
        html.push('    </div>');
        html.push('  </div>');

        // 3. Reports Selection Strip (Allows selecting ANY number of previous reports)
        html.push('  <div class="lab-reports-selection-card">');
        html.push('    <div class="lab-card-title-row">');
        html.push('      <h3>');
        html.push('        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#18aa91" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>');
        html.push('        Patient Reports on File &bull; Select to Compare (' + selectedCount + ' selected)');
        html.push('      </h3>');
        html.push('      <div class="lab-compare-controls">');
        html.push('        <button class="lab-chip-btn" id="btnSelectAllReports">Compare All (' + reports.length + ')</button>');
        html.push('        <span style="color:#cbd5e1;">|</span>');
        html.push('        <button class="lab-chip-btn" id="btnSelectLast3">Last 3</button>');
        html.push('        <span style="color:#cbd5e1;">|</span>');
        html.push('        <button class="lab-chip-btn" id="btnSelectLast2">Last 2</button>');
        html.push('        <span style="color:#cbd5e1;">|</span>');
        html.push('        <button class="lab-chip-btn" id="btnClearSelected">Clear</button>');
        html.push('      </div>');
        html.push('    </div>');

        if (!reports.length) {
            html.push('    <div style="padding:24px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px;border:1px dashed #cbd5e1;">');
            html.push('      <p style="margin:0 0 10px;font-size:15px;font-weight:600;">No laboratory reports found for this patient yet.</p>');
            html.push('      <p style="margin:0 0 14px;font-size:13px;">Upload an existing report or click "Quick Demo Sample" to load realistic laboratory panels.</p>');
            html.push('      <button class="lab-btn lab-btn-primary" id="btnOpenUploadModalEmpty">+ Upload First Report</button>');
            html.push('    </div>');
        } else {
            html.push('    <div class="lab-reports-chips-container">');
            reports.forEach(function (r) {
                var isSelected = state.selectedReportIds.has(r.id);
                var abnCount = (r.tests || []).filter(function (t) { return t.status !== "NORMAL"; }).length;

                html.push('      <div class="lab-report-chip' + (isSelected ? " selected" : "") + '" data-report-id="' + esc(r.id) + '">');
                html.push('        <input type="checkbox" class="lab-report-checkbox" data-check-id="' + esc(r.id) + '"' + (isSelected ? " checked" : "") + '/>');
                html.push('        <div class="lab-report-chip-content">');
                html.push('          <div class="lab-report-chip-title" title="' + esc(r.title) + '">' + esc(r.title) + '</div>');
                html.push('          <div class="lab-report-chip-meta">');
                html.push('            <span><strong>' + esc(r.date) + '</strong></span>');
                html.push('            <span>&bull;</span>');
                html.push('            <span>' + esc(r.facility) + '</span>');
                html.push('          </div>');
                html.push('          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">');
                html.push('            <span class="lab-badge lab-badge-blue">' + (r.tests ? r.tests.length : 0) + ' tests</span>');
                if (abnCount > 0) {
                    html.push('            <span class="lab-badge lab-badge-amber">' + abnCount + ' abnormal</span>');
                } else {
                    html.push('            <span class="lab-badge lab-badge-teal">all normal</span>');
                }
                html.push('          </div>');
                html.push('          <div class="lab-report-chip-actions">');
                html.push('            <button class="lab-chip-btn" data-action="view-report" data-id="' + esc(r.id) + '">View Details</button>');
                html.push('            <span style="color:#cbd5e1;">&bull;</span>');
                html.push('            <button class="lab-chip-btn delete" data-action="delete-report" data-id="' + esc(r.id) + '">Delete</button>');
                html.push('          </div>');
                html.push('        </div>');
                html.push('      </div>');
            });
            html.push('    </div>');
        }
        html.push('  </div>');

        // 4. AI Clinical Comparison Narrative Card
        if (comp && comp.summary) {
            html.push('  <div class="lab-ai-summary-card">');
            html.push('    <div class="lab-ai-summary-header">');
            html.push('      <div class="lab-ai-title">');
            html.push('        <div class="lab-ai-sparkle">&#x2728;</div>');
            html.push('        Automated Longitudinal Trajectory & Clinical Insights (' + selectedCount + ' Reports)');
            html.push('      </div>');
            html.push('      <button class="lab-btn lab-btn-outline" id="btnCopySummaryText" style="padding:6px 12px;font-size:12px;">');
            html.push('        Copy Summary');
            html.push('      </button>');
            html.push('    </div>');
            html.push('    <div class="lab-ai-content">' + esc(comp.summary) + '</div>');
            html.push('  </div>');
        }

        // 5. Comparison Matrix Card
        if (comp && comp.parameters && comp.parameters.length) {
            html.push('  <div class="lab-matrix-card">');
            html.push('    <div class="lab-matrix-toolbar">');
            html.push('      <div class="lab-tabs">');
            categories.forEach(function (cat) {
                var label = cat === "ALL" ? "All Panels" : cat;
                html.push('        <button class="lab-tab-btn' + (state.activeCategory === cat ? " active" : "") + '" data-tab-cat="' + esc(cat) + '">' + esc(label) + '</button>');
            });
            html.push('        <button class="lab-tab-btn' + (state.activeCategory === "ABNORMAL" ? " active" : "") + '" data-tab-cat="ABNORMAL" style="color:#b45309;">Abnormal Only (' + abnormalTestsCount + ')</button>');
            html.push('      </div>');

            html.push('      <input type="text" class="lab-search-input" id="labSearchInput" placeholder="Filter parameters..." value="' + esc(state.searchQuery) + '"/>');
            html.push('    </div>');

            // Table Container
            html.push('    <div class="lab-table-container">');
            html.push('      <table class="lab-table">');
            html.push('        <thead>');
            html.push('          <tr>');
            html.push('            <th>Laboratory Parameter</th>');
            html.push('            <th>Reference Range</th>');

            // Header for each selected report date
            comp.reportHeaders.forEach(function (h) {
                html.push('            <th style="min-width:120px;">');
                html.push('              <div style="font-weight:700;color:#0f172a;">' + esc(h.date) + '</div>');
                html.push('              <div style="font-size:10px;text-transform:none;font-weight:500;color:#64748b;overflow:hidden;text-overflow:ellipsis;max-width:140px;" title="' + esc(h.title) + '">' + esc(h.title) + '</div>');
                html.push('            </th>');
            });

            html.push('            <th>Overall Delta</th>');
            html.push('            <th>Clinical Trajectory</th>');
            html.push('            <th>Trend Curve</th>');
            html.push('          </tr>');
            html.push('        </thead>');
            html.push('        <tbody>');

            if (!filteredParams.length) {
                html.push('          <tr><td colspan="' + (5 + comp.reportHeaders.length) + '" style="text-align:center;padding:32px;color:#64748b;">No parameters match the selected category or search filter.</td></tr>');
            } else {
                filteredParams.forEach(function (p) {
                    html.push('          <tr>');
                    html.push('            <td class="lab-param-cell">');
                    html.push('              <div>' + esc(p.name) + '</div>');
                    html.push('              <div class="lab-param-category">' + esc(p.category) + '</div>');
                    html.push('            </td>');
                    html.push('            <td class="lab-ref-range">' + esc(p.referenceRange) + '</td>');

                    // Each report column value
                    p.history.forEach(function (h) {
                        html.push('            <td>');
                        if (h.value == null) {
                            html.push('              <span style="color:#cbd5e1;font-size:12px;">—</span>');
                        } else {
                            html.push('              <div class="lab-val-wrap">');
                            html.push('                <span class="lab-val-number">' + esc(h.value) + ' <small style="font-size:11px;font-weight:500;color:#64748b;">' + esc(p.unit) + '</small></span>');
                            html.push('                <span class="lab-status-pill ' + esc(h.status) + '">' + esc(h.status) + '</span>');
                            html.push('              </div>');
                        }
                        html.push('            </td>');
                    });

                    // Delta
                    html.push('            <td>');
                    if (p.delta == null) {
                        html.push('              <span style="color:#94a3b8;font-size:12px;">—</span>');
                    } else {
                        var isPos = p.delta > 0;
                        var deltaClass = p.trajectory === "improved" ? "positive-trend" : p.trajectory === "worsened" ? "negative-trend" : "neutral-trend";
                        html.push('              <div class="lab-delta-badge ' + deltaClass + '">');
                        html.push('                <span>' + (isPos ? "+" : "") + p.delta + ' ' + esc(p.unit) + '</span>');
                        if (p.deltaPct != null) {
                            html.push('                <small style="font-size:11px;opacity:0.85;">(' + (isPos ? "+" : "") + p.deltaPct + '%)</small>');
                        }
                        html.push('              </div>');
                    }
                    html.push('            </td>');

                    // Trajectory
                    html.push('            <td>');
                    var trajIcon = p.trajectory === "improved" ? "&#x2713; Improved" : p.trajectory === "worsened" ? "&#x26A0; Worsened" : p.trajectory === "stable_abnormal" ? "&bull; Deviated" : "&bull; Stable";
                    html.push('              <span class="lab-trajectory-tag ' + esc(p.trajectory) + '">' + trajIcon + '</span>');
                    html.push('            </td>');

                    // Sparkline
                    html.push('            <td>');
                    html.push('              ' + generateSparklineSvg(p.history));
                    html.push('            </td>');

                    html.push('          </tr>');
                });
            }

            html.push('        </tbody>');
            html.push('      </table>');
            html.push('    </div>');
            html.push('  </div>');
        }

        html.push('</div>'); // /lab-workspace

        // Upload Modal
        html.push(renderUploadModal());

        // Report View Details Modal
        html.push(renderViewReportModal());

        rootEl.innerHTML = html.join("\n");
        bindEvents();
    }

    function renderUploadModal() {
        var isOpen = state.uploadModalOpen;
        var html = [];
        html.push('<div class="lab-modal-backdrop' + (isOpen ? " open" : "") + '" id="labUploadModal">');
        html.push('  <div class="lab-modal-card">');
        html.push('    <div class="lab-modal-header">');
        html.push('      <h3>Upload &amp; Compare Laboratory Report</h3>');
        html.push('      <button class="lab-modal-close" id="btnCloseUploadModal">&times;</button>');
        html.push('    </div>');

        html.push('    <form id="labUploadForm" style="display:flex;flex-direction:column;gap:16px;">');
        html.push('      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">');
        html.push('        <div>');
        html.push('          <label style="font-size:13px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Report Date</label>');
        html.push('          <input type="date" id="labUploadDate" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;" value="' + new Date().toISOString().slice(0, 10) + '" required/>');
        html.push('        </div>');
        html.push('        <div>');
        html.push('          <label style="font-size:13px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Diagnostic Facility</label>');
        html.push('          <input type="text" id="labUploadFacility" placeholder="e.g. Metropolitan Diagnostics" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;" value="Clinical Pathology Laboratories"/>');
        html.push('        </div>');
        html.push('      </div>');

        html.push('      <div>');
        html.push('        <label style="font-size:13px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Report Title / Panel Type</label>');
        html.push('        <input type="text" id="labUploadTitle" placeholder="e.g. Follow-up CBC &amp; Lipid Profile" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;" value="Follow-up Complete Blood Count &amp; Lipid Profile" required/>');
        html.push('      </div>');

        html.push('      <div class="lab-drop-zone" id="labDropZone">');
        html.push('        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#18aa91" stroke-width="2" style="margin:0 auto 10px;display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>');
        html.push('        <p style="margin:0 0 4px;font-weight:700;color:#0f172a;font-size:14px;">Drop laboratory report here (PDF, TXT, CSV, or Image)</p>');
        html.push('        <p style="margin:0;font-size:12px;color:#64748b;">or click to browse from device</p>');
        html.push('        <input type="file" id="labFileInput" accept=".pdf,.txt,.csv,.json,image/*" style="display:none;"/>');
        html.push('      </div>');

        html.push('      <div>');
        html.push('        <label style="font-size:13px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Or Paste Lab Report Content Below</label>');
        html.push('        <textarea id="labUploadText" rows="6" placeholder="Paste report text here (e.g. Hemoglobin: 14.5 g/dL, Fasting Blood Sugar: 95 mg/dL, Total Cholesterol: 185 mg/dL)..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;resize:vertical;"></textarea>');
        html.push('      </div>');

        html.push('      <div id="labParsedPreviewContainer" style="display:' + (state.previewTests.length ? "block" : "none") + '">');
        html.push('        <h4 style="font-size:13px;font-weight:700;color:#065f46;margin:0 0 6px;">Automatically Extracted Lab Parameters (' + state.previewTests.length + ' detected):</h4>');
        html.push('        <div style="max-height:180px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;">');
        html.push('          <table class="lab-extracted-preview-table">');
        html.push('            <thead><tr><th>Test Name</th><th>Value</th><th>Unit</th><th>Ref Range</th><th>Status</th></tr></thead>');
        html.push('            <tbody>');
        state.previewTests.forEach(function (t) {
            html.push('              <tr>');
            html.push('                <td><strong>' + esc(t.name) + '</strong></td>');
            html.push('                <td>' + esc(t.value) + '</td>');
            html.push('                <td>' + esc(t.unit) + '</td>');
            html.push('                <td>' + (t.min != null && t.max != null ? t.min + ' - ' + t.max : "—") + '</td>');
            html.push('                <td><span class="lab-status-pill ' + esc(t.status) + '">' + esc(t.status) + '</span></td>');
            html.push('              </tr>');
        });
        html.push('            </tbody>');
        html.push('          </table>');
        html.push('        </div>');
        html.push('      </div>');

        html.push('      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">');
        html.push('        <button type="button" class="lab-btn lab-btn-secondary" id="btnCancelUpload">Cancel</button>');
        html.push('        <button type="submit" class="lab-btn lab-btn-primary" id="btnSubmitUpload">Save &amp; Compare Instantly</button>');
        html.push('      </div>');
        html.push('    </form>');

        html.push('  </div>');
        html.push('</div>');
        return html.join("\n");
    }

    function renderViewReportModal() {
        var isOpen = state.viewModalOpen && state.viewingReport;
        var r = state.viewingReport || {};
        var html = [];
        html.push('<div class="lab-modal-backdrop' + (isOpen ? " open" : "") + '" id="labViewModal">');
        html.push('  <div class="lab-modal-card">');
        html.push('    <div class="lab-modal-header">');
        html.push('      <div>');
        html.push('        <h3 style="margin:0 0 4px;">' + esc(r.title || "Report Details") + '</h3>');
        html.push('        <p style="margin:0;font-size:13px;color:#64748b;">' + esc(r.date) + ' &bull; ' + esc(r.facility) + '</p>');
        html.push('      </div>');
        html.push('      <button class="lab-modal-close" id="btnCloseViewModal">&times;</button>');
        html.push('    </div>');

        if (r.tests && r.tests.length) {
            html.push('    <div style="max-height:360px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px;">');
            html.push('      <table class="lab-extracted-preview-table" style="margin-top:0;">');
            html.push('        <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>');
            html.push('        <tbody>');
            r.tests.forEach(function (t) {
                html.push('          <tr>');
                html.push('            <td><strong>' + esc(t.name) + '</strong><br><small style="color:#64748b;">' + esc(t.category) + '</small></td>');
                html.push('            <td><strong>' + esc(t.value) + '</strong></td>');
                html.push('            <td>' + esc(t.unit) + '</td>');
                html.push('            <td>' + (t.min != null && t.max != null ? t.min + ' - ' + t.max : "—") + '</td>');
                html.push('            <td><span class="lab-status-pill ' + esc(t.status) + '">' + esc(t.status) + '</span></td>');
                html.push('          </tr>');
            });
            html.push('        </tbody>');
            html.push('      </table>');
            html.push('    </div>');
        }

        if (r.notes) {
            html.push('    <div style="background:#f8fafc;padding:12px 14px;border-radius:10px;font-size:13px;color:#334155;">');
            html.push('      <strong>Clinical Notes:</strong> ' + esc(r.notes));
            html.push('    </div>');
        }

        html.push('    <div style="display:flex;justify-content:flex-end;margin-top:6px;">');
        html.push('      <button type="button" class="lab-btn lab-btn-secondary" id="btnCloseViewBtn">Close</button>');
        html.push('    </div>');

        html.push('  </div>');
        html.push('</div>');
        return html.join("\n");
    }

    // -----------------------------------------------------------------------
    // Event Handlers & User Actions
    // -----------------------------------------------------------------------
    function bindEvents() {
        // Patient selector
        var sel = document.getElementById("labPatientSelect");
        if (sel) {
            sel.addEventListener("change", function () {
                state.activePatientId = sel.value;
                fetchReports(state.activePatientId);
            });
        }

        // Open Upload Modal
        var btnUpload = document.getElementById("btnOpenUploadModal");
        var btnUploadEmpty = document.getElementById("btnOpenUploadModalEmpty");
        if (btnUpload) btnUpload.addEventListener("click", function () { state.uploadModalOpen = true; render(); });
        if (btnUploadEmpty) btnUploadEmpty.addEventListener("click", function () { state.uploadModalOpen = true; render(); });

        var btnCloseUpload = document.getElementById("btnCloseUploadModal");
        var btnCancelUpload = document.getElementById("btnCancelUpload");
        if (btnCloseUpload) btnCloseUpload.addEventListener("click", function () { state.uploadModalOpen = false; render(); });
        if (btnCancelUpload) btnCancelUpload.addEventListener("click", function () { state.uploadModalOpen = false; render(); });

        // Close View Details Modal
        var btnCloseView = document.getElementById("btnCloseViewModal");
        var btnCloseViewBtn = document.getElementById("btnCloseViewBtn");
        if (btnCloseView) btnCloseView.addEventListener("click", function () { state.viewModalOpen = false; render(); });
        if (btnCloseViewBtn) btnCloseViewBtn.addEventListener("click", function () { state.viewModalOpen = false; render(); });

        // Quick Demo Sample Report Generator
        var btnSample = document.getElementById("btnSampleReport");
        if (btnSample) {
            btnSample.addEventListener("click", async function () {
                var todayStr = new Date().toISOString().slice(0, 10);
                var samplePayload = {
                    date: todayStr,
                    title: "Follow-up Comprehensive Metabolic & Hematology Panel",
                    facility: "Metropolitan Central Hospital",
                    category: "Routine Monitoring",
                    notes: "Patient reports regular compliance with treatment. Excellent biometric normalization.",
                    tests: [
                        { name: "Hemoglobin (Hgb)", category: "Hematology", value: 15.6, unit: "g/dL", min: 13.5, max: 17.5 },
                        { name: "White Blood Cell Count (WBC)", category: "Hematology", value: 6.4, unit: "x10^3/uL", min: 4.5, max: 11.0 },
                        { name: "Platelet Count", category: "Hematology", value: 250, unit: "x10^3/uL", min: 150, max: 450 },
                        { name: "Fasting Blood Glucose", category: "Diabetic / Glycemic", value: 94, unit: "mg/dL", min: 70, max: 99 },
                        { name: "HbA1c (Glycated Hemoglobin)", category: "Diabetic / Glycemic", value: 5.5, unit: "%", min: 4.0, max: 5.6 },
                        { name: "Total Cholesterol", category: "Lipid Profile", value: 178, unit: "mg/dL", min: 125, max: 200 },
                        { name: "LDL Cholesterol", category: "Lipid Profile", value: 96, unit: "mg/dL", min: 0, max: 100 },
                        { name: "HDL Cholesterol", category: "Lipid Profile", value: 56, unit: "mg/dL", min: 40, max: 60 },
                        { name: "Triglycerides", category: "Lipid Profile", value: 124, unit: "mg/dL", min: 0, max: 150 },
                        { name: "Serum Creatinine", category: "Renal Function", value: 0.92, unit: "mg/dL", min: 0.70, max: 1.30 },
                        { name: "eGFR (Glomerular Filtration)", category: "Renal Function", value: 92, unit: "mL/min/1.73m²", min: 60, max: 120 },
                        { name: "ALT (SGPT)", category: "Liver Function", value: 28, unit: "U/L", min: 7, max: 56 }
                    ]
                };
                await uploadReport(samplePayload);
            });
        }

        // Copy comparison narrative to SOAP Note
        var btnCopySoap = document.getElementById("btnCopySoap");
        if (btnCopySoap) {
            btnCopySoap.addEventListener("click", function () {
                if (!state.comparison || !state.comparison.summary) {
                    showToast("No comparison summary available to copy.", "err");
                    return;
                }
                var text = state.comparison.summary;
                // If Voice2Rx is active, insert into tests field
                var testField = document.querySelector("#f-objective-tests");
                if (testField) {
                    testField.value = (testField.value ? testField.value + "\n\n" : "") + text;
                    testField.dispatchEvent(new Event("input", { bubbles: true }));
                }
                navigator.clipboard.writeText(text).then(function () {
                    showToast("Comparison trend copied! Also appended to consultation note.", "ok");
                }).catch(function () {
                    showToast("Appended comparison to consultation note.", "ok");
                });
            });
        }

        var btnCopySummary = document.getElementById("btnCopySummaryText");
        if (btnCopySummary && state.comparison) {
            btnCopySummary.addEventListener("click", function () {
                navigator.clipboard.writeText(state.comparison.summary).then(function () {
                    showToast("Clinical summary copied to clipboard.", "ok");
                });
            });
        }

        // Print comparison sheet
        var btnPrint = document.getElementById("btnPrintReport");
        if (btnPrint) {
            btnPrint.addEventListener("click", function () {
                window.print();
            });
        }

        // Checkboxes in report chips
        document.querySelectorAll(".lab-report-checkbox").forEach(function (chk) {
            chk.addEventListener("change", async function (e) {
                e.stopPropagation();
                var id = chk.dataset.checkId;
                if (chk.checked) state.selectedReportIds.add(id);
                else state.selectedReportIds.delete(id);
                await fetchComparison();
                render();
            });
        });

        // Quick report selection buttons
        var btnAll = document.getElementById("btnSelectAllReports");
        if (btnAll) {
            btnAll.addEventListener("click", async function () {
                state.selectedReportIds = new Set(state.reports.map(function (r) { return r.id; }));
                await fetchComparison();
                render();
            });
        }

        var btnLast3 = document.getElementById("btnSelectLast3");
        if (btnLast3) {
            btnLast3.addEventListener("click", async function () {
                var sorted = state.reports.slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
                state.selectedReportIds = new Set(sorted.slice(0, 3).map(function (r) { return r.id; }));
                await fetchComparison();
                render();
            });
        }

        var btnLast2 = document.getElementById("btnSelectLast2");
        if (btnLast2) {
            btnLast2.addEventListener("click", async function () {
                var sorted = state.reports.slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
                state.selectedReportIds = new Set(sorted.slice(0, 2).map(function (r) { return r.id; }));
                await fetchComparison();
                render();
            });
        }

        var btnClear = document.getElementById("btnClearSelected");
        if (btnClear) {
            btnClear.addEventListener("click", async function () {
                state.selectedReportIds.clear();
                await fetchComparison();
                render();
            });
        }

        // View or Delete report clicks
        document.querySelectorAll("[data-action='view-report']").forEach(function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                var rep = state.reports.find(function (r) { return r.id === btn.dataset.id; });
                if (rep) {
                    state.viewingReport = rep;
                    state.viewModalOpen = true;
                    render();
                }
            });
        });

        document.querySelectorAll("[data-action='delete-report']").forEach(function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                deleteReport(btn.dataset.id);
            });
        });

        // Category tabs
        document.querySelectorAll("[data-tab-cat]").forEach(function (tab) {
            tab.addEventListener("click", function () {
                state.activeCategory = tab.dataset.tabCat;
                render();
            });
        });

        // Search input
        var searchInput = document.getElementById("labSearchInput");
        if (searchInput) {
            searchInput.addEventListener("input", function () {
                state.searchQuery = searchInput.value;
                render();
                var s = document.getElementById("labSearchInput");
                if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
            });
        }

        // Upload Form Events & Live Parser Preview
        var uploadForm = document.getElementById("labUploadForm");
        var uploadText = document.getElementById("labUploadText");
        var dropZone = document.getElementById("labDropZone");
        var fileInput = document.getElementById("labFileInput");

        if (uploadText) {
            var debounceTimer;
            uploadText.addEventListener("input", function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async function () {
                    var text = uploadText.value.trim();
                    if (text.length > 10) {
                        state.previewTests = await parseTextPreview(text);
                        var cont = document.getElementById("labParsedPreviewContainer");
                        if (cont) cont.style.display = state.previewTests.length ? "block" : "none";
                        render();
                    }
                }, 400);
            });
        }

        if (dropZone && fileInput) {
            dropZone.addEventListener("click", function () { fileInput.click(); });
            dropZone.addEventListener("dragover", function (e) { e.preventDefault(); dropZone.classList.add("dragover"); });
            dropZone.addEventListener("dragleave", function () { dropZone.classList.remove("dragover"); });
            dropZone.addEventListener("drop", function (e) {
                e.preventDefault();
                dropZone.classList.remove("dragover");
                if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
            });
            fileInput.addEventListener("change", function () {
                if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
            });
        }

        function handleFile(file) {
            var reader = new FileReader();
            reader.onload = async function (e) {
                var content = e.target.result;
                if (typeof content === "string") {
                    uploadText.value = content;
                    state.previewTests = await parseTextPreview(content);
                } else {
                    uploadText.value = "File attached: " + file.name + " (" + Math.round(file.size / 1024) + " KB)";
                }
                var titleInput = document.getElementById("labUploadTitle");
                if (titleInput && (!titleInput.value || titleInput.value.includes("Follow-up Complete"))) {
                    titleInput.value = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
                }
                render();
            };
            if (file.type.includes("pdf") || file.name.endsWith(".pdf")) {
                // Read as text representation or binary
                reader.readAsText(file);
            } else {
                reader.readAsText(file);
            }
        }

        if (uploadForm) {
            uploadForm.addEventListener("submit", async function (e) {
                e.preventDefault();
                var title = (document.getElementById("labUploadTitle")?.value || "").trim();
                var date = (document.getElementById("labUploadDate")?.value || "").trim();
                var facility = (document.getElementById("labUploadFacility")?.value || "").trim();
                var text = (document.getElementById("labUploadText")?.value || "").trim();

                var payload = {
                    title: title || "Laboratory Report",
                    date: date || new Date().toISOString().slice(0, 10),
                    facility: facility || "Clinical Laboratory",
                    category: "Diagnostic Panel",
                    rawText: text,
                    tests: state.previewTests.length ? state.previewTests : undefined
                };

                await uploadReport(payload);
                state.uploadModalOpen = false;
                state.previewTests = [];
                render();
            });
        }
    }

    // -----------------------------------------------------------------------
    // Public Initialization API
    // -----------------------------------------------------------------------
    function init(container) {
        rootEl = container || document.getElementById("viewLabReports");
        if (!rootEl) return;
        fetchReports(state.activePatientId);
    }

    window.ClinicOSLabReports = {
        init: init,
        setPatient: function (patientId) {
            state.activePatientId = patientId;
            if (rootEl) fetchReports(patientId);
        },
        refresh: function () {
            if (rootEl) fetchReports(state.activePatientId);
        },
        getState: function () { return state; }
    };
})();
