import os
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict

from backend.app.database.session import get_db
from backend.app.core.config import settings
from backend.app.models.models import Document, DocumentSegment
from backend.app.schemas.schemas import DocumentResponse
from backend.app.services.document_processing import (
    process_document,
    delete_document_file_and_record
)
from backend.app.services.pdf_highlighter import highlight_pdf_bytes

router = APIRouter(prefix="/documents", tags=["Documents"])

class SegmentDetail(BaseModel):
    id: int
    page_number: int
    segment_type: str
    content: str
    extraction_method: str

    model_config = ConfigDict(from_attributes=True)


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: int, db: Session = Depends(get_db)):
    """Retrieve document metadata."""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {document_id} not found."
        )
    seg_count = db.query(DocumentSegment).filter(DocumentSegment.document_id == doc.id).count()
    return DocumentResponse(
        id=doc.id,
        patient_id=doc.patient_id,
        original_filename=doc.original_filename,
        file_type=doc.file_type,
        file_size=doc.file_size,
        file_hash=doc.file_hash,
        page_count=doc.page_count,
        processing_status=doc.processing_status,
        processing_error=doc.processing_error,
        ocr_applied=doc.ocr_applied,
        uploaded_at=doc.uploaded_at,
        processed_at=doc.processed_at,
        segment_count=seg_count
    )


@router.get("/{document_id}/content")
def get_document_content(
    document_id: int,
    highlight: Optional[str] = None,
    download: bool = False,
    db: Session = Depends(get_db)
):
    """
    Download or stream the uploaded document.
    If 'highlight' is provided and the document is a PDF, generates a real-time
    annotated PDF with both standard Adobe Highlight Annotations and visual
    semi-transparent yellow overlays on every occurrence of the search term.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {document_id} not found."
        )

    file_path = os.path.join(settings.STORAGE_DIR, doc.stored_filename)
    if not os.path.isfile(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The requested file is no longer present on the server storage."
        )

    disposition = "attachment" if download else "inline"

    # If PDF and highlight term is requested, return dynamically highlighted PDF
    if doc.file_type == "pdf" and highlight and highlight.strip():
        try:
            with open(file_path, "rb") as f:
                raw_bytes = f.read()
            annotated_bytes, count, locations = highlight_pdf_bytes(raw_bytes, highlight.strip())
            out_filename = f"highlighted_{doc.original_filename}" if download else doc.original_filename
            return Response(
                content=annotated_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'{disposition}; filename="{out_filename}"',
                    "X-Highlight-Count": str(count),
                    "Access-Control-Expose-Headers": "X-Highlight-Count, Content-Disposition"
                }
            )
        except Exception as e:
            # Fall back to un-annotated original if annotation fails
            pass

    media_types = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain; charset=utf-8"
    }
    media_type = media_types.get(doc.file_type, "application/octet-stream")

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=doc.original_filename,
        content_disposition_type=disposition
    )


@router.get("/{document_id}/search-locations")
def get_document_search_locations(
    document_id: int,
    q: str,
    db: Session = Depends(get_db)
):
    """
    Get exact bounding box coordinates and pages where query 'q' occurs in a PDF document.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {document_id} not found."
        )

    file_path = os.path.join(settings.STORAGE_DIR, doc.stored_filename)
    if not os.path.isfile(file_path) or doc.file_type != "pdf":
        return {
            "document_id": document_id,
            "query": q,
            "total_locations": 0,
            "pages_with_matches": [],
            "locations": []
        }

    try:
        with open(file_path, "rb") as f:
            raw_bytes = f.read()
        _, count, locations = highlight_pdf_bytes(raw_bytes, q.strip())
        pages = sorted(list(set(loc["page"] for loc in locations)))
        return {
            "document_id": document_id,
            "query": q,
            "total_locations": count,
            "pages_with_matches": pages,
            "locations": locations
        }
    except Exception as e:
        return {
            "document_id": document_id,
            "query": q,
            "total_locations": 0,
            "pages_with_matches": [],
            "locations": [],
            "error": str(e)
        }


@router.get("/{document_id}/segments", response_model=List[SegmentDetail])
def get_document_segments(document_id: int, db: Session = Depends(get_db)):
    """Retrieve all extracted text segments and page locations for a document."""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {document_id} not found."
        )

    segments = (
        db.query(DocumentSegment)
        .filter(DocumentSegment.document_id == document_id)
        .order_by(DocumentSegment.page_number.asc(), DocumentSegment.id.asc())
        .all()
    )
    return segments


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: Session = Depends(get_db)):
    """Delete a document, cascade delete its indexed segments, and remove file from disk."""
    success = delete_document_file_and_record(db, document_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {document_id} not found."
        )
    return None


@router.post("/{document_id}/reprocess", response_model=DocumentResponse)
def reprocess_single_document(document_id: int, db: Session = Depends(get_db)):
    """Retry text extraction and reindexing for a document."""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID {document_id} not found."
        )

    processed = process_document(db, doc.id)
    seg_count = db.query(DocumentSegment).filter(DocumentSegment.document_id == processed.id).count()

    return DocumentResponse(
        id=processed.id,
        patient_id=processed.patient_id,
        original_filename=processed.original_filename,
        file_type=processed.file_type,
        file_size=processed.file_size,
        file_hash=processed.file_hash,
        page_count=processed.page_count,
        processing_status=processed.processing_status,
        processing_error=processed.processing_error,
        ocr_applied=processed.ocr_applied,
        uploaded_at=processed.uploaded_at,
        processed_at=processed.processed_at,
        segment_count=seg_count
    )
