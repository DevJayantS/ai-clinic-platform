// ===============================
// DOCTOR DASHBOARD AUTH
// ===============================

const user = JSON.parse(
    localStorage.getItem("loggedInUser")
);


// If user is not logged in
if (!user || user.role !== "doctor") {

    window.location.href = "doctor-login.html";

}


// ===============================
// SHOW DOCTOR NAME
// ===============================

const doctorName = document.querySelector("#doctorName");

const sidebarDoctorName =
    document.querySelector("#sidebarDoctorName");


if (doctorName) {

    doctorName.textContent = user.name;

}


if (sidebarDoctorName) {

    sidebarDoctorName.textContent = user.name;

}


// ===============================
// LOGOUT
// ===============================

const logoutBtn =
    document.querySelector("#logoutBtn");


if (logoutBtn) {

    logoutBtn.addEventListener("click", function () {

        localStorage.removeItem("loggedInUser");

        window.location.href = "doctor-login.html";

    });

}