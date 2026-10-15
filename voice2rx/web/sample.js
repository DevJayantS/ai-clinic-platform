/* Synthetic demo data only. */
window.V2RSample = {
    patient: { id: "Demo Patient 001", name: "Demo Patient 001", age: "" },
    transcript: [
        "This is a demonstration consultation using synthetic data only.",
        "Patient Demo Patient 001.",
        "Complaint of fever and headache for two days.",
        "Examination not provided.",
        "Assessment is awaiting clinician assessment.",
        "Plan is awaiting clinician input.",
        "Medication mentioned: paracetamol, strength and frequency not stated."
    ].join("\n")
};

/* Synthetic patient list for the demo (matches the names on the doctor dashboard). */
window.V2RPatients = [
    { id: "Demo Patient 001", name: "Demo Patient 001", age: "", note: "Synthetic demo patient" },
    { id: "PAT-2001", name: "Arthur Pendelton", age: "54" },
    { id: "PT-1001", name: "Rahul Sharma", age: "32" },
    { id: "PT-1002", name: "Priya Kumar", age: "28" },
    { id: "PT-1003", name: "Amit Singh", age: "45" },
    { id: "PT-1004", name: "Neha Gupta", age: "" }
];
