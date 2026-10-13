// ClinicOS doctor dashboard: display only appointments assigned to the logged-in doctor
(() => {
    const user = JSON.parse(localStorage.getItem("loggedInUser") || "null");
    if (!user || user.role !== "doctor") {
        window.location.href = "doctor-login.html";
        return;
    }

    const STORAGE_KEY = "clinicAppointments";
    const $ = (selector) => document.querySelector(selector);
    const readAppointments = () => {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    };
    const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
    const today = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
    const formatTime = (time) => {
        if (!time) return "";
        const [hour, minute] = time.split(":").map(Number);
        const d = new Date();
        d.setHours(hour, minute, 0, 0);
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    const statusClass = (status) => status === "Completed" ? "current" : status === "Cancelled" ? "cancelled" : "waiting";

    $("#doctorName").textContent = user.name;
    $("#sidebarDoctorName").textContent = user.name;

    function renderQueue(items) {
        const target = $("#doctorQueue");
        const waiting = items.filter(item => item.status === "Waiting").sort((a, b) => a.time.localeCompare(b.time));
        if (!waiting.length) {
            target.innerHTML = '<p class="empty-state">No patients are in your queue yet. The receptionist can add appointments for you.</p>';
            return;
        }
        target.innerHTML = waiting.map((item, index) => `
            <div class="queue-patient patient-clickable" tabindex="0" data-patient-id="${escapeHTML(item.id)}">
                <div class="patient-number">${String(index + 1).padStart(2, "0")}</div>
                <div class="patient-avatar">${escapeHTML(initials(item.patientName))}</div>
                <div class="patient-info">
                    <strong>${escapeHTML(item.patientName)}</strong>
                    <span>${escapeHTML(item.visitType)} • ${escapeHTML(formatTime(item.time))}</span>
                </div>
                <span class="status waiting">Waiting</span>
            </div>`).join("");
    }

    function renderAppointments(items) {
        const target = $("#doctorAppointments");
        if (!items.length) {
            target.innerHTML = '<p class="empty-state">No appointments scheduled for today.</p>';
            return;
        }
        target.innerHTML = items.slice().sort((a, b) => a.time.localeCompare(b.time)).map(item => `
            <div class="appointment patient-clickable" tabindex="0" data-patient-id="${escapeHTML(item.id)}">
                <div class="appointment-time"><strong>${escapeHTML(item.time)}</strong><span>${escapeHTML(formatTime(item.time).split(" ").slice(-1)[0] || "")}</span></div>
                <div class="appointment-line"></div>
                <div class="appointment-details">
                    <strong>${escapeHTML(item.patientName)}</strong>
                    <span>${escapeHTML(item.visitType)}${item.phone ? " • " + escapeHTML(item.phone) : ""}</span>
                </div>
                <span class="status ${statusClass(item.status)}">${escapeHTML(item.status)}</span>
            </div>`).join("");
    }

    function renderRecent(items) {
        const target = $("#doctorRecentPatients");
        if (!items.length) {
            target.innerHTML = '<p class="empty-state">No patients have been registered for you yet.</p>';
            return;
        }
        target.innerHTML = items.slice().sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).map(item => `
            <div class="table-row patient-clickable" tabindex="0" data-patient-id="${escapeHTML(item.id)}">
                <div class="table-patient"><div class="patient-avatar">${escapeHTML(initials(item.patientName))}</div><strong>${escapeHTML(item.patientName)}</strong></div>
                <span>${item.age ? escapeHTML(item.age) : "—"}</span>
                <span>${escapeHTML(item.date)} • ${escapeHTML(formatTime(item.time))}</span>
                <span>${escapeHTML(item.reason || item.visitType || "—")}</span>
                <span class="table-status">${escapeHTML(item.status)}</span>
            </div>`).join("");
    }

    function showPatientDetails(id) {
        const item = readAppointments().find(appointment => appointment.id === id);
        if (!item) return;
        const details = [
            `Patient: ${item.patientName}`,
            `Phone: ${item.phone || "Not provided"}`,
            `Age: ${item.age || "Not provided"}`,
            `Appointment: ${item.date} at ${formatTime(item.time)}`,
            `Visit: ${item.visitType}`,
            `Status: ${item.status}`,
            `Reason: ${item.reason || "Not provided"}`
        ].join("\n");
        alert(details);
    }

    function render() {
        const allForDoctor = readAppointments().filter(item => item.doctor === user.name && item.status !== "Cancelled");
        const todayItems = allForDoctor.filter(item => item.date === today());
        $("#doctorTodayCount").textContent = todayItems.length;
        $("#doctorWaitingCount").textContent = todayItems.filter(item => item.status === "Waiting").length;
        $("#doctorConsultationCount").textContent = todayItems.filter(item => item.status === "Completed").length;
        $("#doctorRevenue").textContent = "₹0";
        renderQueue(todayItems);
        renderAppointments(todayItems);
        renderRecent(allForDoctor);
    }

    document.addEventListener("click", (event) => {
        const row = event.target.closest("[data-patient-id]");
        if (row) showPatientDetails(row.dataset.patientId);
    });
    document.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-patient-id]")) {
            event.preventDefault();
            showPatientDetails(event.target.dataset.patientId);
        }
    });

    $("#logoutBtn").addEventListener("click", () => {
        localStorage.removeItem("loggedInUser");
        window.location.href = "doctor-login.html";
    });
    window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) render();
    });
    render();
})();
