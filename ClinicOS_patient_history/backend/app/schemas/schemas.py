from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict

# Patient Schemas
class PatientBase(BaseModel):
    patient_code: str = Field(..., min_length=2, max_length=64, description="Unique patient identifier, e.g. PAT-1001")
    display_name: str = Field(..., min_length=1, max_length=255, description="Full name or identifier for the patient")

class PatientCreate(BaseModel):
    patient_code: Optional[str] = Field(None, max_length=64, description="Unique patient code (auto-generated if omitted)")
    display_name: str = Field(..., min_length=1, max_length=255, description="Patient display name")

class PatientResponse(PatientBase):
    id: int
    created_at: datetime
    document_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# Document Schemas
class DocumentResponse(BaseModel):
    id: int
    patient_id: int
    original_filename: str
    file_type: str
    file_size: int
    file_hash: str
    page_count: int
    processing_status: str
    processing_error: Optional[str] = None
    ocr_applied: bool = False
    uploaded_at: datetime
    processed_at: Optional[datetime] = None
    segment_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# Search Result Schemas
class SearchOccurrence(BaseModel):
    occurrence_id: str
    document_id: int
    document_filename: str
    file_type: str
    page_number: int
    segment_type: str
    matched_text: str
    context_excerpt: str
    start_offset: int
    end_offset: int
    extraction_method: str

    model_config = ConfigDict(from_attributes=True)


class SearchResponse(BaseModel):
    patient_id: int
    patient_code: str
    patient_name: str
    query: str
    mode: str = "exact"  # 'exact' or 'flexible'
    total_matches: int
    matching_documents_count: int
    total_searched_documents: int
    processing_documents_count: int = 0
    failed_documents_count: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 1
    results: List[SearchOccurrence] = []
    warnings: List[str] = []

    model_config = ConfigDict(from_attributes=True)


class SystemStatusResponse(BaseModel):
    ocr_available: bool
    ocr_engine: str
    max_upload_size_bytes: int
    allowed_extensions: List[str]
    total_patients: int
    total_documents: int

    model_config = ConfigDict(from_attributes=True)
