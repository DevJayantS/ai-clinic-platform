// ClinicOS receptionist dashboard + shared appointment storage
(() => {
    const currentUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");
    if (!currentUser || currentUser.role !== "receptionist") {
        window.location.href = "reception-login.html";
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
    const writeAppointments = (appointments) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
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
        if (!time) return "Time not set";
        const [hour, minute] = time.split(":").map(Number);
        const date = new Date();
        date.setHours(hour, minute, 0, 0);
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    const statusClass = (status) => status === "Completed" ? "current" : status === "Cancelled" ? "cancelled" : "waiting";

    $("#receptionistName").textContent = currentUser.name;
    $("#receptionHeaderName").textContent = currentUser.name;

    const modal = $("#patientModal");
    const form = $("#patientAppointmentForm");
    const dateInput = $("#appointmentDate");
    dateInput.value = today();
    dateInput.min = today();
    const now = new Date();
    now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
    $("#appointmentTime").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const openModal = () => {
        $("#patientFormError").textContent = "";
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        $("#patientName").focus();
    };
    const closeModal = () => {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
    };
    $("#openPatientModal").addEventListener("click", openModal);
    document.querySelector(".reception-add")?.addEventListener("click", openModal);
    $("#closePatientModal").addEventListener("click", closeModal);
    $("#cancelPatientModal").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const patientName = $("#patientName").value.trim();
        const phone = $("#patientPhone").value.trim();
        const date = $("#appointmentDate").value;
        const time = $("#appointmentTime").value;
        const doctor = $("#appointmentDoctor").value;
        if (!patientName || !phone || !date || !time || !doctor) {
            $("#patientFormError").textContent = "Please complete all required fields.";
            return;
        }
        if (date < today()) {
            $("#patientFormError").textContent = "Appointment date cannot be in the past.";
            return;
        }

        const appointments = readAppointments();
        const slotTaken = appointments.some(item =>
            item.doctor === doctor && item.date === date && item.time === time && item.status !== "Cancelled"
        );
        if (slotTaken) {
            $("#patientFormError").textContent = "This doctor already has an appointment at that time. Choose another time.";
            return;
        }

        appointments.push({
            id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            patientName,
            phone,
            age: $("#patientAge").value ? Number($("#patientAge").value) : "",
            visitType: $("#visitType").value,
            doctor,
            date,
            time,
            reason: $("#patientReason").value.trim(),
            status: "Waiting",
            createdAt: new Date().toISOString(),
            createdBy: currentUser.name
        });
        writeAppointments(appointments);
        form.reset();
        dateInput.value = today();
        dateInput.min = today();
        $("#appointmentTime").value = time;
        closeModal();
        render();
        alert(`Appointment saved for ${patientName} with ${doctor}. It will appear on that doctor's dashboard.`);
    });

    function renderAppointments(items) {
        const target = $("#receptionAppointments");
        if (!items.length) {
            target.innerHTML = '<p class="empty-state">No appointments booked for today. Use + Add to book one.</p>';
            return;
        }
        target.innerHTML = items.slice().sort((a, b) => a.time.localeCompare(b.time)).map(item => `
            <div class="appointment">
                <div class="appointment-time"><strong>${escapeHTML(item.time)}</strong><span>${escapeHTML(formatTime(item.time).split(" ").slice(-1)[0] || "")}</span></div>
                <div class="appointment-line blue-line"></div>
                <div class="appointment-details">
                    <strong>${escapeHTML(item.patientName)}</strong>
                    <span>${escapeHTML(item.doctor)} • ${escapeHTML(item.visitType)}</span>
                    <small>${escapeHTML(item.phone)}${item.reason ? " • " + escapeHTML(item.reason) : ""}</small>
                </div>
                <span class="status ${statusClass(item.status)}">${escapeHTML(item.status)}</span>
            </div>`).join("");
    }

    function renderQueue(items) {
        const target = $("#receptionQueue");
        const waiting = items.filter(item => item.status === "Waiting").sort((a, b) => a.time.localeCompare(b.time));
        if (!waiting.length) {
            target.innerHTML = '<p class="empty-state">No patients are currently waiting.</p>';
            return;
        }
        target.innerHTML = waiting.map((item, index) => `
            <div class="queue-patient">
                <div class="patient-number">${String(index + 1).padStart(2, "0")}</div>
                <div class="patient-avatar">${escapeHTML(initials(item.patientName))}</div>
                <div class="patient-info">
                    <strong>${escapeHTML(item.patientName)}</strong>
                    <span>${escapeHTML(item.doctor)} • ${escapeHTML(formatTime(item.time))}</span>
                </div>
                <span class="status waiting">Waiting</span>
            </div>`).join("");
    }

    function renderActivity(items) {
        const target = $("#receptionActivity");
        const recent = items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
        if (!recent.length) {
            target.innerHTML = '<p class="empty-state">New patient registrations and bookings will appear here.</p>';
            return;
        }
        target.innerHTML = recent.map(item => `
            <div class="activity-item">
                <div class="activity-icon green-icon">✓</div>
                <div><strong>Appointment booked</strong><p>${escapeHTML(item.patientName)} with ${escapeHTML(item.doctor)}</p></div>
                <span>${escapeHTML(new Date(item.createdAt).toLocaleDateString())}</span>
            </div>`).join("");
    }

    function render() {
        const all = readAppointments();
        const todayItems = all.filter(item => item.date === today() && item.status !== "Cancelled");
        const waiting = todayItems.filter(item => item.status === "Waiting");
        $("#receptionTodayAppointments").textContent = todayItems.length;
        $("#receptionTotalPatients").textContent = new Set(all.map(item => `${item.patientName.toLowerCase()}|${item.phone}`)).size;
        $("#receptionWaitingCount").textContent = waiting.length;
        $("#receptionCollection").textContent = "₹0";
        $("#billingCollected").textContent = "₹0";
        $("#billingPending").textContent = "₹0";
        $("#billingTransactions").textContent = "0";
        renderAppointments(todayItems);
        renderQueue(todayItems);
        renderActivity(all);
    }

    $("#receptionLogout").addEventListener("click", () => {
        localStorage.removeItem("loggedInUser");
        window.location.href = "reception-login.html";
    });
    window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) render();
    });
    render();
})();
