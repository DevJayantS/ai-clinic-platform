from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.app.database.session import get_db
from backend.app.core.config import settings
from backend.app.models.models import Patient, Document
from backend.app.schemas.schemas import SystemStatusResponse
from backend.app.services.ocr_service import is_ocr_available
from backend.seed_demo_data import seed_database

router = APIRouter(prefix="/system", tags=["System"])

@router.get("/status", response_model=SystemStatusResponse)
def get_system_status(db: Session = Depends(get_db)):
    """System status and diagnostic information."""
    ocr_ready, ocr_engine = is_ocr_available()
    total_patients = db.query(Patient).count()
    total_documents = db.query(Document).count()

    return SystemStatusResponse(
        ocr_available=ocr_ready,
        ocr_engine=ocr_engine,
        max_upload_size_bytes=settings.MAX_UPLOAD_SIZE_BYTES,
        allowed_extensions=settings.ALLOWED_EXTENSIONS,
        total_patients=total_patients,
        total_documents=total_documents
    )

@router.post("/seed-demo", status_code=status.HTTP_200_OK)
def trigger_seed_demo():
    """Reset and reseed demonstration patients and synthetic reports."""
    seed_database(reset=True)
    return {"message": "Demonstration database successfully re-seeded with synthetic patients and documents."}
