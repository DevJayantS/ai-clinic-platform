// ===============================
// RECEPTIONIST DASHBOARD AUTH
// ===============================

const user = JSON.parse(
    localStorage.getItem("loggedInUser")
);


// Check login

if (!user || user.role !== "receptionist") {

    window.location.href = "reception-login.html";

}


// ===============================
// SHOW RECEPTIONIST NAME
// ===============================

const receptionistName =
    document.querySelector("#receptionistName");

const receptionHeaderName =
    document.querySelector("#receptionHeaderName");


if (receptionistName) {

    receptionistName.textContent = user.name;

}


if (receptionHeaderName) {

    receptionHeaderName.textContent = user.name;

}


// ===============================
// LOGOUT
// ===============================

const logoutBtn =
    document.querySelector("#receptionLogout");


if (logoutBtn) {

    logoutBtn.addEventListener("click", function () {

        localStorage.removeItem("loggedInUser");

        window.location.href = "reception-login.html";

    });

}