from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from backend.app.database.session import Base

def utc_now():
    return datetime.now(timezone.utc)

class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    patient_code = Column(String(64), unique=True, index=True, nullable=False)
    display_name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    # Relationship with cascade delete
    documents = relationship(
        "Document", 
        back_populates="patient", 
        cascade="all, delete-orphan",
        order_by="Document.uploaded_at.desc()"
    )

    def __repr__(self):
        return f"<Patient(id={self.id}, code='{self.patient_code}', name='{self.display_name}')>"


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), unique=True, nullable=False)
    file_type = Column(String(32), nullable=False)  # pdf, docx, txt
    file_size = Column(Integer, nullable=False)  # in bytes
    file_hash = Column(String(64), nullable=False, index=True)  # SHA-256
    page_count = Column(Integer, default=0, nullable=False)
    processing_status = Column(String(32), default="pending", nullable=False, index=True)
    # Statuses: 'pending', 'processing', 'completed', 'partially_completed', 'failed'
    processing_error = Column(Text, nullable=True)
    ocr_applied = Column(Boolean, default=False, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)

    patient = relationship("Patient", back_populates="documents")
    segments = relationship(
        "DocumentSegment", 
        back_populates="document", 
        cascade="all, delete-orphan",
        order_by="DocumentSegment.page_number.asc(), DocumentSegment.id.asc()"
    )

    def __repr__(self):
        return f"<Document(id={self.id}, name='{self.original_filename}', status='{self.processing_status}')>"


class DocumentSegment(Base):
    __tablename__ = "document_segments"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    page_number = Column(Integer, default=1, nullable=False, index=True)  # 1-indexed for PDF, paragraph index for docx/txt
    segment_type = Column(String(32), default="page", nullable=False)  # 'page', 'paragraph', 'section'
    content = Column(Text, nullable=False)
    extraction_method = Column(String(32), default="direct", nullable=False)  # 'direct', 'ocr', 'fallback'
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    document = relationship("Document", back_populates="segments")

    __table_args__ = (
        Index("idx_doc_segment_search", "document_id", "page_number"),
    )

    def __repr__(self):
        return f"<DocumentSegment(id={self.id}, doc_id={self.document_id}, page={self.page_number})>"
