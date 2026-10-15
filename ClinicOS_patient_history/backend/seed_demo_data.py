import os
import sys
import shutil
import logging

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from sqlalchemy.orm import Session
from backend.app.core.config import settings
from backend.app.database.session import SessionLocal, Base, engine
from backend.app.models.models import Patient, Document, DocumentSegment
from backend.app.services.document_processing import store_uploaded_file, process_document
from backend.synthetic_data_generator import write_sample_pdf, write_sample_docx, write_sample_txt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SAMPLE_DIR = os.path.join(settings.BASE_DIR, "sample_data", "generated")

def generate_sample_files():
    """Create local synthetic files with known contents on disk."""
    os.makedirs(SAMPLE_DIR, exist_ok=True)

    # 1. PAT-1001 Files
    p1_txt = os.path.join(SAMPLE_DIR, "PAT1001_Medical_History.txt")
    write_sample_txt(
        p1_txt,
        [
            "PATIENT MEDICAL HISTORY RECORD - CLINICAL DOCUMENTATION",
            "The patient has a documented history of allergies dating back to adolescence.",
            "Allergies include seasonal pollen and severe reactions to penicillin medication.",
            "No known food allergies were reported during admission interview.",
            "Allergies were investigated during the previous consultation and verified by attending staff."
        ]
    )

    p1_pdf = os.path.join(SAMPLE_DIR, "PAT1001_Allergy_Assessment.pdf")
    write_sample_pdf(
        p1_pdf,
        [
            # Page 1
            [
                "METROPOLITAN HOSPITAL - ALLERGY EVALUATION REPORT",
                "Patient Identifier: PAT-1001",
                "Clinical Assessment: The patient has a history of allergies.",
                "The allergy test returned positive for airborne environmental triggers.",
                "The report mentions possible allergies to cephalosporins as well.",
                "Immediate allergy precautions must be flagged in chart."
            ],
            # Page 2
            [
                "METROPOLITAN HOSPITAL - TREATMENT & FOLLOW-UP PLAN",
                "Patient Identifier: PAT-1001",
                "Prescription: Non-drowsy antihistamine medication 10mg daily.",
                "Follow-up allergy panel ordered in six months.",
                "Patient instructed on anaphylaxis protocol and self-monitoring."
            ]
        ]
    )

    p1_docx = os.path.join(SAMPLE_DIR, "PAT1001_Discharge_Summary.docx")
    write_sample_docx(
        p1_docx,
        [
            "HOSPITAL DISCHARGE SUMMARY - ADMISSION 2026",
            "Admission Diagnosis: Acute sinus inflammation.",
            "Allergies were investigated during the previous consultation.",
            "Confirmed no known allergies to surgical latex or adhesive dressings.",
            "Blood pressure was monitored continuously and remained normal throughout admission.",
            "Discharge instructions and medication reconciliation completed with patient."
        ]
    )

    # 2. PAT-1002 Files
    p2_txt = os.path.join(SAMPLE_DIR, "PAT1002_Previous_Treatment.txt")
    write_sample_txt(
        p2_txt,
        [
            "OUTPATIENT TREATMENT NOTES - CARDIOVASCULAR CLINIC",
            "Patient Identifier: PAT-1002",
            "Routine monitoring for chronic hypertension and type 2 diabetes.",
            "Patient reports daily blood pressure readings between 125/80 and 135/85 mmHg.",
            "Adjusted anti-hypertensive medication dosage to maintain stable vascular parameters."
        ]
    )

    p2_pdf = os.path.join(SAMPLE_DIR, "PAT1002_Laboratory_Report.pdf")
    write_sample_pdf(
        p2_pdf,
        [
            # Page 1
            [
                "DIAGNOSTIC BIOCHEMISTRY LAB REPORT",
                "Patient Identifier: PAT-1002",
                "Fasting blood glucose: 114 mg/dL (Target: < 100 mg/dL).",
                "HbA1c: 6.4 percent consistent with controlled diabetes.",
                "Kidney function panel shows normal estimated glomerular filtration rate."
            ],
            # Page 2
            [
                "VASCULAR & LIPID MONITORING RECORD",
                "Patient Identifier: PAT-1002",
                "Resting blood pressure: 128/82 mmHg.",
                "Total cholesterol and triglycerides remain within target clinical goals.",
                "Continuing current treatment regimen with three month review."
            ]
        ]
    )

    # 3. PAT-1003 Files
    p3_docx = os.path.join(SAMPLE_DIR, "PAT1003_Consultation_Notes.docx")
    write_sample_docx(
        p3_docx,
        [
            "PULMONARY CONSULTATION RECORD",
            "Patient Identifier: PAT-1003",
            "Patient presented with persistent dry cough following a viral respiratory infection.",
            "Secondary bacterial infection was considered but sputum culture showed no pathogenic growth.",
            "Symptomatic treatment provided with hydration and rest.",
            "Follow-up consultation recommended if symptoms persist over seven days."
        ]
    )

    return {
        "PAT-1001": [p1_txt, p1_pdf, p1_docx],
        "PAT-1002": [p2_txt, p2_pdf],
        "PAT-1003": [p3_docx]
    }


def seed_database(reset: bool = True):
    """Seed synthetic demonstration patients and process their documents."""
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()

    try:
        if reset:
            logger.info("Resetting demonstration data...")
            # Clean up files in storage
            if os.path.exists(settings.STORAGE_DIR):
                shutil.rmtree(settings.STORAGE_DIR)
            os.makedirs(settings.STORAGE_DIR, exist_ok=True)

            # Clean up db tables
            db.query(DocumentSegment).delete()
            db.query(Document).delete()
            db.query(Patient).delete()
            db.commit()

        logger.info("Generating synthetic files...")
        file_map = generate_sample_files()

        patient_configs = [
            ("PAT-1001", "Demonstration Patient One"),
            ("PAT-1002", "Demonstration Patient Two"),
            ("PAT-1003", "Demonstration Patient Three")
        ]

        for code, name in patient_configs:
            pat = db.query(Patient).filter(Patient.patient_code == code).first()
            if not pat:
                pat = Patient(patient_code=code, display_name=name)
                db.add(pat)
                db.commit()
                db.refresh(pat)

            files = file_map.get(code, [])
            for file_path in files:
                orig_name = os.path.basename(file_path).split("_", 1)[-1]
                with open(file_path, "rb") as f:
                    content = f.read()

                stored_name, safe_orig, file_type, file_size, file_hash = store_uploaded_file(
                    content=content,
                    original_filename=orig_name,
                    patient_id=pat.id
                )

                doc = Document(
                    patient_id=pat.id,
                    original_filename=safe_orig,
                    stored_filename=stored_name,
                    file_type=file_type,
                    file_size=file_size,
                    file_hash=file_hash,
                    processing_status="pending"
                )
                db.add(doc)
                db.commit()
                db.refresh(doc)

                # Process extraction
                process_document(db, doc.id)
                logger.info(f"Seeded and processed {doc.original_filename} for {pat.patient_code}")

        logger.info("Demonstration database seeding successfully completed.")

    finally:
        db.close()

if __name__ == "__main__":
    seed_database(reset=True)
