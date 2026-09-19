// ================= LOGIN DATA =================

const users = [

    {
        email: "aditi@clinicos.com",
        password: "Aditi@123",
        role: "doctor",
        name: "Dr. Aditi Soni"
    },

    {
        email: "adarsh@clinicos.com",
        password: "Adarsh@123",
        role: "doctor",
        name: "Dr. Adarsh Soni"
    },

    {
        email: "yash@clinicos.com",
        password: "Yash@123",
        role: "receptionist",
        name: "Yash"
    }

];


// ================= DOCTOR LOGIN =================

const doctorForm = document.querySelector("#doctorLoginForm");

if (doctorForm) {

    doctorForm.addEventListener("submit", function (e) {

        e.preventDefault();

        const email =
            document.querySelector("#doctorEmail").value.trim();

        const password =
            document.querySelector("#doctorPassword").value;


        const user = users.find(function (user) {

            return (
                user.email === email &&
                user.password === password &&
                user.role === "doctor"
            );

        });


        if (user) {

            localStorage.setItem(
                "loggedInUser",
                JSON.stringify(user)
            );

            window.location.href = "doctor-dashboard.html";

        } else {

            showLoginError(
                "Invalid doctor email or password."
            );

        }

    });

}



// ================= RECEPTION LOGIN =================

const receptionForm =
    document.querySelector("#receptionLoginForm");


if (receptionForm) {

    receptionForm.addEventListener("submit", function (e) {

        e.preventDefault();

        const email =
            document.querySelector("#receptionEmail").value.trim();

        const password =
            document.querySelector("#receptionPassword").value;


        const user = users.find(function (user) {

            return (
                user.email === email &&
                user.password === password &&
                user.role === "receptionist"
            );

        });


        if (user) {

            localStorage.setItem(
                "loggedInUser",
                JSON.stringify(user)
            );

            window.location.href =
                "reception-dashboard.html";

        } else {

            showLoginError(
                "Invalid receptionist email or password."
            );

        }

    });

}



// ================= ERROR MESSAGE =================

function showLoginError(message) {

    let error =
        document.querySelector(".login-error");


    if (!error) {

        error = document.createElement("p");

        error.className = "login-error";

        const form =
            document.querySelector("form");

        form.appendChild(error);

    }


    error.textContent = message;

}