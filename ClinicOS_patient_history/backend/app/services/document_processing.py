import os
import uuid
import hashlib
import logging
from datetime import datetime, timezone
from typing import Tuple, Optional
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models.models import Document, DocumentSegment
from backend.app.services.text_extraction import (
    extract_document_segments,
    ExtractionError,
    ExtractedSegment
)

logger = logging.getLogger(__name__)

class DocumentProcessingError(Exception):
    pass

def compute_file_hash(content: bytes) -> str:
    """Compute SHA-256 hash of file contents."""
    return hashlib.sha256(content).hexdigest()

def sanitize_filename(filename: str) -> str:
    """Strip dangerous characters and directory traversals."""
    base = os.path.basename(filename).strip()
    # Replace non-standard characters while keeping reasonable filename
    cleaned = "".join(c for c in base if c.isalnum() or c in "._- ")
    return cleaned or "document"

def get_file_extension(filename: str) -> str:
    """Return lowercase extension including dot, e.g. .pdf"""
    _, ext = os.path.splitext(filename)
    return ext.lower()

def store_uploaded_file(
    content: bytes, 
    original_filename: str, 
    patient_id: int
) -> Tuple[str, str, str, int, str]:
    """
    Validates and stores an uploaded file.
    Returns: (stored_filename, original_filename, file_type, file_size, file_hash)
    """
    # 1. Size check
    file_size = len(content)
    if file_size == 0:
        raise DocumentProcessingError("Uploaded file is empty (0 bytes).")
    if file_size > settings.MAX_UPLOAD_SIZE_BYTES:
        max_mb = settings.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
        raise DocumentProcessingError(
            f"File size ({file_size / (1024*1024):.2f} MB) exceeds maximum allowed limit of {max_mb:.0f} MB."
        )

    # 2. Extension check
    ext = get_file_extension(original_filename)
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise DocumentProcessingError(
            f"File format '{ext}' is not supported. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}"
        )

    # 3. Hash computation
    file_hash = compute_file_hash(content)

    # 4. Generate safe unique stored filename
    safe_orig = sanitize_filename(original_filename)
    unique_id = uuid.uuid4().hex[:12]
    stored_filename = f"pat_{patient_id}_{unique_id}_{safe_orig}"
    target_path = os.path.join(settings.STORAGE_DIR, stored_filename)

    # 5. Write file
    with open(target_path, "wb") as f:
        f.write(content)

    file_type = ext.replace(".", "")
    return stored_filename, safe_orig, file_type, file_size, file_hash


def process_document(db: Session, document_id: int) -> Document:
    """
    Extracts text, updates segments, and sets final processing status.
    Idempotent: removes any previous segments on reprocess.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise DocumentProcessingError(f"Document {document_id} not found.")

    doc.processing_status = "processing"
    doc.processing_error = None
    db.commit()

    file_path = os.path.join(settings.STORAGE_DIR, doc.stored_filename)
    if not os.path.isfile(file_path):
        doc.processing_status = "failed"
        doc.processing_error = "Original file is missing from storage."
        doc.processed_at = datetime.now(timezone.utc)
        db.commit()
        return doc

    try:
        segments: list[ExtractedSegment] = extract_document_segments(file_path, doc.file_type)

        # Clear old segments if reprocessing
        db.query(DocumentSegment).filter(DocumentSegment.document_id == doc.id).delete()

        ocr_was_used = False
        max_page = 0

        for seg in segments:
            if seg.extraction_method == "ocr":
                ocr_was_used = True
            if seg.page_number > max_page:
                max_page = seg.page_number

            db_segment = DocumentSegment(
                document_id=doc.id,
                page_number=seg.page_number,
                segment_type=seg.segment_type,
                content=seg.content,
                extraction_method=seg.extraction_method,
            )
            db.add(db_segment)

        if not segments:
            doc.page_count = 0
            doc.processing_status = "failed"
            doc.processing_error = "No readable text content could be extracted from this document."
        else:
            doc.page_count = max_page if max_page > 0 else len(segments)
            doc.processing_status = "completed"
            doc.processing_error = None
            doc.ocr_applied = ocr_was_used

        doc.processed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(doc)
        return doc

    except ExtractionError as e:
        logger.error(f"Extraction error for document {doc.id}: {e}")
        doc.processing_status = "failed"
        doc.processing_error = str(e)
        doc.processed_at = datetime.now(timezone.utc)
        db.commit()
        return doc
    except Exception as e:
        logger.exception(f"Unexpected error processing document {doc.id}")
        doc.processing_status = "failed"
        doc.processing_error = f"Unexpected processing error: {str(e)}"
        doc.processed_at = datetime.now(timezone.utc)
        db.commit()
        return doc


def delete_document_file_and_record(db: Session, document_id: int) -> bool:
    """Deletes document record, cascades segments, and removes file from disk."""
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        return False

    file_path = os.path.join(settings.STORAGE_DIR, doc.stored_filename)
    if os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except OSError as e:
            logger.warning(f"Failed to delete stored file {file_path}: {e}")

    db.delete(doc)
    db.commit()
    return True
