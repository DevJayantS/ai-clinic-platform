import random
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.database.session import get_db
from backend.app.models.models import Patient, Document, DocumentSegment
from backend.app.schemas.schemas import (
    PatientResponse,
    PatientCreate,
    DocumentResponse,
    SearchResponse
)
from backend.app.services.document_processing import (
    store_uploaded_file,
    process_document,
    DocumentProcessingError
)
from backend.app.services.search_service import search_patient_documents

router = APIRouter(prefix="/patients", tags=["Patients"])

def generate_patient_code(db: Session) -> str:
    """Generate next sequential or random unique patient code e.g. PAT-1001."""
    count = db.query(Patient).count()
    code = f"PAT-{1001 + count}"
    # Ensure uniqueness
    while db.query(Patient).filter(Patient.patient_code == code).first():
        code = f"PAT-{random.randint(2000, 9999)}"
    return code


@router.get("", response_model=List[PatientResponse])
def list_patients(db: Session = Depends(get_db)):
    """List all patients with document count."""
    patients = db.query(Patient).order_by(Patient.created_at.desc()).all()
    results = []
    for p in patients:
        doc_count = db.query(Document).filter(Document.patient_id == p.id).count()
        results.append(
            PatientResponse(
                id=p.id,
                patient_code=p.patient_code,
                display_name=p.display_name,
                created_at=p.created_at,
                document_count=doc_count
            )
        )
    return results


@router.post("", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db)):
    """Create a new patient."""
    code = payload.patient_code.strip() if payload.patient_code else generate_patient_code(db)
    
    existing = db.query(Patient).filter(Patient.patient_code == code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Patient code '{code}' is already registered."
        )

    patient = Patient(
        patient_code=code,
        display_name=payload.display_name.strip()
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    return PatientResponse(
        id=patient.id,
        patient_code=patient.patient_code,
        display_name=patient.display_name,
        created_at=patient.created_at,
        document_count=0
    )


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    """Retrieve details for a single patient."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient with ID {patient_id} does not exist."
        )
    doc_count = db.query(Document).filter(Document.patient_id == patient.id).count()
    return PatientResponse(
        id=patient.id,
        patient_code=patient.patient_code,
        display_name=patient.display_name,
        created_at=patient.created_at,
        document_count=doc_count
    )


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(patient_id: int, db: Session = Depends(get_db)):
    """Delete a patient and cascade delete all their documents and files."""
    from backend.app.services.document_processing import delete_document_file_and_record
    
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient with ID {patient_id} does not exist."
        )
    
    # Delete each document file
    docs = db.query(Document).filter(Document.patient_id == patient.id).all()
    for doc in docs:
        delete_document_file_and_record(db, doc.id)

    db.delete(patient)
    db.commit()
    return None


@router.get("/{patient_id}/documents", response_model=List[DocumentResponse])
def list_patient_documents(patient_id: int, db: Session = Depends(get_db)):
    """List all documents belonging to a patient."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient with ID {patient_id} does not exist."
        )

    docs = db.query(Document).filter(Document.patient_id == patient_id).order_by(Document.uploaded_at.desc()).all()
    results = []
    for d in docs:
        seg_count = db.query(DocumentSegment).filter(DocumentSegment.document_id == d.id).count()
        results.append(
            DocumentResponse(
                id=d.id,
                patient_id=d.patient_id,
                original_filename=d.original_filename,
                file_type=d.file_type,
                file_size=d.file_size,
                file_hash=d.file_hash,
                page_count=d.page_count,
                processing_status=d.processing_status,
                processing_error=d.processing_error,
                ocr_applied=d.ocr_applied,
                uploaded_at=d.uploaded_at,
                processed_at=d.processed_at,
                segment_count=seg_count
            )
        )
    return results


@router.post("/{patient_id}/documents", response_model=List[DocumentResponse])
async def upload_patient_documents(
    patient_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload one or multiple documents for a patient.
    Validates, stores, extracts text, and indexes each document.
    """
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient with ID {patient_id} does not exist."
        )

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files were provided in the upload request."
        )

    responses: List[DocumentResponse] = []

    for file in files:
        filename = file.filename or "unknown_file"
        try:
            content = await file.read()
            stored_name, safe_orig, file_type, file_size, file_hash = store_uploaded_file(
                content=content,
                original_filename=filename,
                patient_id=patient.id
            )

            # Check if this exact file hash already exists for this patient
            existing_doc = db.query(Document).filter(
                Document.patient_id == patient.id,
                Document.file_hash == file_hash
            ).first()

            if existing_doc:
                # Document already exists, return existing or mark note
                seg_count = db.query(DocumentSegment).filter(DocumentSegment.document_id == existing_doc.id).count()
                responses.append(
                    DocumentResponse(
                        id=existing_doc.id,
                        patient_id=existing_doc.patient_id,
                        original_filename=existing_doc.original_filename,
                        file_type=existing_doc.file_type,
                        file_size=existing_doc.file_size,
                        file_hash=existing_doc.file_hash,
                        page_count=existing_doc.page_count,
                        processing_status=existing_doc.processing_status,
                        processing_error=existing_doc.processing_error or "Duplicate file already uploaded for this patient.",
                        ocr_applied=existing_doc.ocr_applied,
                        uploaded_at=existing_doc.uploaded_at,
                        processed_at=existing_doc.processed_at,
                        segment_count=seg_count
                    )
                )
                continue

            doc = Document(
                patient_id=patient.id,
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

            # Process document extraction
            processed_doc = process_document(db, doc.id)
            seg_count = db.query(DocumentSegment).filter(DocumentSegment.document_id == processed_doc.id).count()

            responses.append(
                DocumentResponse(
                    id=processed_doc.id,
                    patient_id=processed_doc.patient_id,
                    original_filename=processed_doc.original_filename,
                    file_type=processed_doc.file_type,
                    file_size=processed_doc.file_size,
                    file_hash=processed_doc.file_hash,
                    page_count=processed_doc.page_count,
                    processing_status=processed_doc.processing_status,
                    processing_error=processed_doc.processing_error,
                    ocr_applied=processed_doc.ocr_applied,
                    uploaded_at=processed_doc.uploaded_at,
                    processed_at=processed_doc.processed_at,
                    segment_count=seg_count
                )
            )

        except DocumentProcessingError as e:
            # File validation or store error
            fake_doc = Document(
                patient_id=patient.id,
                original_filename=filename,
                stored_filename=f"failed_{random.randint(1000, 9999)}",
                file_type="unknown",
                file_size=0,
                file_hash="none",
                processing_status="failed",
                processing_error=str(e)
            )
            db.add(fake_doc)
            db.commit()
            db.refresh(fake_doc)

            responses.append(
                DocumentResponse(
                    id=fake_doc.id,
                    patient_id=fake_doc.patient_id,
                    original_filename=fake_doc.original_filename,
                    file_type=fake_doc.file_type,
                    file_size=fake_doc.file_size,
                    file_hash=fake_doc.file_hash,
                    page_count=0,
                    processing_status="failed",
                    processing_error=str(e),
                    ocr_applied=False,
                    uploaded_at=fake_doc.uploaded_at,
                    processed_at=None,
                    segment_count=0
                )
            )

    return responses


@router.get("/{patient_id}/search", response_model=SearchResponse)
def search_patient_records(
    patient_id: int,
    q: str = Query(..., min_length=1, description="Word or phrase to search"),
    mode: str = Query("exact", pattern="^(exact|flexible)$", description="Matching mode: exact or flexible"),
    page: int = Query(1, ge=1, description="Page number for pagination"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
    db: Session = Depends(get_db)
):
    """
    Search across all indexed documents belonging strictly to the selected patient.
    """
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient with ID {patient_id} does not exist."
        )

    return search_patient_documents(
        db=db,
        patient=patient,
        query=q,
        mode=mode,
        page=page,
        page_size=page_size
    )
