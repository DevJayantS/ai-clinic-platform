import os
import sys
import logging
from typing import Dict, List, Tuple

# Ensure root directory is on PYTHONPATH
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from sqlalchemy.orm import Session
from backend.app.core.config import settings
from backend.app.database.session import SessionLocal, Base, engine
from backend.app.models.models import Patient, Document, DocumentSegment
from backend.app.services.document_processing import (
    store_uploaded_file,
    process_document,
    compute_file_hash,
    delete_document_file_and_record
)
from backend.app.services.generate_realistic_reports import generate_all_realistic_reports

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Dedicated directory for sample reports
SAMPLE_REPORTS_DIR = os.path.join(ROOT_DIR, "sample_medical_reports")


def generate_all_sample_reports() -> Dict[str, Dict]:
    """
    Generate 14 realistic, multi-category medical reports across 4 patients.
    All files are stored in sample_medical_reports/<PATIENT_CODE>/
    """
    os.makedirs(SAMPLE_REPORTS_DIR, exist_ok=True)
    generate_all_realistic_reports(SAMPLE_REPORTS_DIR)

    p1_dir = os.path.join(SAMPLE_REPORTS_DIR, "PAT-2001")
    p2_dir = os.path.join(SAMPLE_REPORTS_DIR, "PAT-2002")
    p3_dir = os.path.join(SAMPLE_REPORTS_DIR, "PAT-2003")
    p4_dir = os.path.join(SAMPLE_REPORTS_DIR, "PAT-2004")

    return {
        "PAT-2001": {
            "display_name": "Arthur Pendelton",
            "files": [
                os.path.join(p1_dir, "PAT2001_CBC_Blood_Test.pdf"),
                os.path.join(p1_dir, "PAT2001_Allergy_Panel_Report.pdf"),
                os.path.join(p1_dir, "PAT2001_Chest_Xray_Report.pdf"),
                os.path.join(p1_dir, "PAT2001_General_Medicine_Discharge_Summary.docx")
            ]
        },
        "PAT-2002": {
            "display_name": "Eleanor Vance",
            "files": [
                os.path.join(p2_dir, "PAT2002_Specific_IgE_Blood_Test.pdf"),
                os.path.join(p2_dir, "PAT2002_Lipid_Profile_Report.pdf"),
                os.path.join(p2_dir, "PAT2002_CT_Abdomen_Scan.docx"),
                os.path.join(p2_dir, "PAT2002_Emergency_Department_Discharge_Summary.txt")
            ]
        },
        "PAT-2003": {
            "display_name": "Marcus Sterling",
            "files": [
                os.path.join(p3_dir, "PAT2003_Blood_Glucose_Monitoring_Report.pdf"),
                os.path.join(p3_dir, "PAT2003_Lumbar_Spine_MRI_Report.pdf"),
                os.path.join(p3_dir, "PAT2003_Post_Surgical_Discharge_Summary.pdf")
            ]
        },
        "PAT-2004": {
            "display_name": "Sophia Lin",
            "files": [
                os.path.join(p4_dir, "PAT2004_Skin_Prick_Allergy_Test.txt"),
                os.path.join(p4_dir, "PAT2004_Brain_MRI_Report.pdf"),
                os.path.join(p4_dir, "PAT2004_Comprehensive_Metabolic_CBC_Panel.pdf")
            ]
        }
    }


def seed_synthetic_reports_to_database(clean: bool = False):
    """
    Import synthetic reports into the application's database and storage
    using the exact same validation and indexing pipeline as user uploads.
    Idempotent: will not create duplicate patients or documents on repeated runs.
    """
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()

    try:
        logger.info("Generating realistic medical documents into sample_medical_reports/...")
        patient_data = generate_all_sample_reports()

        for patient_code, info in patient_data.items():
            display_name = info["display_name"]
            file_paths = info["files"]

            # 1. Idempotent Patient Lookup / Creation
            patient = db.query(Patient).filter(Patient.patient_code == patient_code).first()
            if not patient:
                patient = Patient(patient_code=patient_code, display_name=display_name)
                db.add(patient)
                db.commit()
                db.refresh(patient)
                logger.info(f"Created Patient: {patient.patient_code} - {patient.display_name}")
            else:
                logger.info(f"Patient exists: {patient.patient_code} - {patient.display_name}")

            # 2. Idempotent Document Ingestion
            for file_path in file_paths:
                orig_filename = os.path.basename(file_path)
                with open(file_path, "rb") as f:
                    file_bytes = f.read()

                file_hash = compute_file_hash(file_bytes)

                # Check if document already exists
                existing_doc = db.query(Document).filter(
                    Document.patient_id == patient.id,
                    Document.original_filename == orig_filename
                ).first()

                # If existing document has matching hash and not clean mode, skip
                if existing_doc and existing_doc.file_hash == file_hash and not clean:
                    logger.info(f"  [Skipped - Unchanged] {orig_filename} for {patient.patient_code}")
                    continue

                # If hash changed or clean mode requested, remove old record and file
                if existing_doc:
                    logger.info(f"  [Refreshing Updated Document] {orig_filename} for {patient.patient_code}")
                    delete_document_file_and_record(db, existing_doc.id)

                stored_name, safe_orig, file_type, file_size, f_hash = store_uploaded_file(
                    content=file_bytes,
                    original_filename=orig_filename,
                    patient_id=patient.id
                )

                doc = Document(
                    patient_id=patient.id,
                    original_filename=safe_orig,
                    stored_filename=stored_name,
                    file_type=file_type,
                    file_size=file_size,
                    file_hash=f_hash,
                    processing_status="pending"
                )
                db.add(doc)
                db.commit()
                db.refresh(doc)

                # Execute parsing and indexing pipeline
                processed = process_document(db, doc.id)
                seg_count = db.query(DocumentSegment).filter(DocumentSegment.document_id == processed.id).count()
                logger.info(
                    f"  [Indexed Successfully] {processed.original_filename} ({processed.file_type.upper()}) "
                    f"- {processed.page_count} Pages/Segments ({seg_count} indexed chunks)"
                )

        logger.info("All realistic medical reports successfully imported and indexed.")

    finally:
        db.close()


if __name__ == "__main__":
    seed_synthetic_reports_to_database(clean=False)
