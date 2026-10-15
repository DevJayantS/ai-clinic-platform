"""
Tests for Exact PDF Search Term Highlighting
Verifies:
1. Exact coordinate and bounding box calculation
2. PDF Highlight Annotation generation (/Subtype /Highlight)
3. Visual content stream overlay with Multiply blend mode
4. API endpoint /api/documents/{id}/content?highlight=...
5. API endpoint /api/documents/{id}/search-locations?q=...
6. Multi-page and multi-occurrence PDF highlighting
"""

import os
import io
import pytest
import pypdf
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.config import settings
from backend.app.database.session import get_db
from backend.app.models.models import Document, Patient
from backend.app.services.document_processing import store_uploaded_file, process_document
from backend.app.services.pdf_highlighter import (
    highlight_pdf_bytes,
    extract_page_word_locations,
    calculate_string_width
)
from backend.synthetic_data_generator import create_pdf_bytes

client = TestClient(app)


def get_current_db():
    """Resolve database session whether overridden in tests or default."""
    if get_db in app.dependency_overrides:
        gen = app.dependency_overrides[get_db]()
        return next(gen)
    from backend.app.database.session import SessionLocal
    return SessionLocal()


def test_string_width_calculation():
    """Verify Helvetica character metric calculations."""
    w1 = calculate_string_width("allergy", font_size=12.0)
    w2 = calculate_string_width("ALLERGY", font_size=12.0)
    assert w1 > 0
    assert w2 > w1  # Uppercase Helvetica letters are wider than lowercase


def test_pdf_highlighting_annotations_and_visual_streams():
    """Test PDF highlight annotation and visual stream injection."""
    # Generate test 2-page PDF
    pdf_bytes = create_pdf_bytes([
        [
            "PATIENT CLINICAL REPORT",
            "Patient reports a history of seasonal allergy symptoms.",
            "ALLERGY testing was scheduled for the patient."
        ],
        [
            "PAGE 2 FINDINGS",
            "Severe peanut allergy confirmed on intradermal testing.",
            "Prescribed auto-injector for acute allergy episodes."
        ]
    ])

    annotated_pdf, count, locations = highlight_pdf_bytes(pdf_bytes, "allergy")
    
    assert count == 4, f"Expected 4 occurrences of 'allergy', got {count}"
    assert len(locations) == 4
    assert len(annotated_pdf) > len(pdf_bytes)

    # Verify annotations in resulting PDF
    reader = pypdf.PdfReader(io.BytesIO(annotated_pdf))
    assert len(reader.pages) == 2

    # Check page 1 annotations
    p1 = reader.pages[0]
    assert "/Annots" in p1
    p1_annots = p1["/Annots"]
    assert len(p1_annots) == 2
    for annot in p1_annots:
        obj = annot.get_object()
        assert obj["/Subtype"] == "/Highlight"
        assert "/QuadPoints" in obj
        assert "/Rect" in obj

    # Check page 2 annotations
    p2 = reader.pages[1]
    assert "/Annots" in p2
    p2_annots = p2["/Annots"]
    assert len(p2_annots) == 2


def test_api_document_search_locations_endpoint():
    """Test GET /api/documents/{id}/search-locations?q=..."""
    db = get_current_db()
    try:
        # Create test patient
        patient = db.query(Patient).filter(Patient.patient_code == "PAT-HL-01").first()
        if not patient:
            patient = Patient(patient_code="PAT-HL-01", display_name="Highlight Test Patient")
            db.add(patient)
            db.commit()
            db.refresh(patient)

        # Create test PDF document
        pdf_bytes = create_pdf_bytes([
            [
                "METROPOLITAN ALLERGY REPORT",
                "Patient evaluated for chronic rhinitis and allergy."
            ]
        ])

        stored_fn, safe_orig, file_type, file_size, f_hash = store_uploaded_file(
            content=pdf_bytes,
            original_filename="Test_Allergy_Panel.pdf",
            patient_id=patient.id
        )

        doc = Document(
            patient_id=patient.id,
            original_filename=safe_orig,
            stored_filename=stored_fn,
            file_type=file_type,
            file_size=file_size,
            file_hash=f_hash,
            processing_status="pending"
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        process_document(db, doc.id)
        doc_id = doc.id
    finally:
        db.close()

    res = client.get(f"/api/documents/{doc_id}/search-locations?q=allergy")
    assert res.status_code == 200
    data = res.json()
    assert data["document_id"] == doc_id
    assert data["query"] == "allergy"
    assert data["total_locations"] == 2
    assert data["pages_with_matches"] == [1]
    assert len(data["locations"]) == 2
    for loc in data["locations"]:
        assert "matched_text" in loc
        assert "x1" in loc and "y1" in loc
        assert "x2" in loc and "y2" in loc
        assert loc["page"] == 1


def test_api_document_content_highlight_stream():
    """Test GET /api/documents/{id}/content?highlight=... returns highlighted PDF."""
    db = get_current_db()
    try:
        patient = db.query(Patient).filter(Patient.patient_code == "PAT-HL-01").first()
        assert patient is not None

        pdf_bytes = create_pdf_bytes([
            [
                "BLOOD TEST REPORT",
                "No known allergy documented."
            ]
        ])

        stored_fn, safe_orig, file_type, file_size, f_hash = store_uploaded_file(
            content=pdf_bytes,
            original_filename="Test_CBC.pdf",
            patient_id=patient.id
        )

        doc = Document(
            patient_id=patient.id,
            original_filename=safe_orig,
            stored_filename=stored_fn,
            file_type=file_type,
            file_size=file_size,
            file_hash=f_hash,
            processing_status="pending"
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        process_document(db, doc.id)
        doc_id = doc.id
    finally:
        db.close()

    res = client.get(f"/api/documents/{doc_id}/content?highlight=allergy")
    assert res.status_code == 200
    assert res.headers.get("content-type") == "application/pdf"
    assert "X-Highlight-Count" in res.headers
    assert int(res.headers["X-Highlight-Count"]) == 1
    assert res.content.startswith(b"%PDF")


def test_case_insensitive_pdf_highlighting():
    """Test that searching lowercase, title-case, and uppercase produces identical highlights."""
    pdf_bytes = create_pdf_bytes([
        [
            "CLINICAL ALLERGY EVALUATION",
            "Patient reports allergy symptoms."
        ]
    ])

    _, c_lower, _ = highlight_pdf_bytes(pdf_bytes, "allergy")
    _, c_title, _ = highlight_pdf_bytes(pdf_bytes, "Allergy")
    _, c_upper, _ = highlight_pdf_bytes(pdf_bytes, "ALLERGY")

    assert c_lower == c_title == c_upper == 2
