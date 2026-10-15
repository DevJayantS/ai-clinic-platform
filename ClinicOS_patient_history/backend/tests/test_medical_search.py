import os
import shutil
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.session import Base, get_db
from backend.app.models.models import Patient, Document, DocumentSegment
from backend.app.services.document_processing import store_uploaded_file, process_document
from backend.app.services.search_service import search_patient_documents, build_search_regex, get_word_variants
from backend.app.services.ocr_service import is_ocr_available
from backend.synthetic_data_generator import create_pdf_bytes, write_sample_pdf, write_sample_docx, write_sample_txt
from backend.app.main import app

# In-memory or temporary SQLite test database
TEST_DB_PATH = os.path.join(settings.BASE_DIR, "storage", "test_search.db")
TEST_STORAGE_DIR = os.path.join(settings.BASE_DIR, "storage", "test_documents")

test_engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    # Configure test paths
    os.makedirs(TEST_STORAGE_DIR, exist_ok=True)
    settings.STORAGE_DIR = TEST_STORAGE_DIR
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    yield
    # Cleanup
    Base.metadata.drop_all(bind=test_engine)
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass
    if os.path.exists(TEST_STORAGE_DIR):
        try:
            shutil.rmtree(TEST_STORAGE_DIR)
        except OSError:
            pass

@pytest.fixture
def db():
    database = TestingSessionLocal()
    try:
        yield database
    finally:
        database.close()


# -------------------------------------------------------------
# TEST 1: Basic Word Search
# -------------------------------------------------------------
def test_01_basic_word_search(db):
    pat = Patient(patient_code="PAT-TEST-01", display_name="Test Patient 1")
    db.add(pat)
    db.commit()
    db.refresh(pat)

    content = b"The patient has a known history of allergies recorded in notes."
    stored_name, safe_orig, ftype, fsize, fhash = store_uploaded_file(content, "history.txt", pat.id)
    doc = Document(
        patient_id=pat.id,
        original_filename=safe_orig,
        stored_filename=stored_name,
        file_type=ftype,
        file_size=fsize,
        file_hash=fhash
    )
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    res = search_patient_documents(db, pat, "allergies")
    assert res.total_matches == 1
    assert res.matching_documents_count == 1
    assert res.results[0].document_filename == "history.txt"
    assert "allergies" in res.results[0].matched_text.lower()


# -------------------------------------------------------------
# TEST 2: Case-Insensitive Search
# -------------------------------------------------------------
def test_02_case_insensitive_search(db):
    pat = db.query(Patient).filter(Patient.patient_code == "PAT-TEST-01").first()
    res_upper = search_patient_documents(db, pat, "ALLERGIES")
    res_lower = search_patient_documents(db, pat, "allergies")
    res_mixed = search_patient_documents(db, pat, "AllErGies")

    assert res_upper.total_matches == 1
    assert res_lower.total_matches == 1
    assert res_mixed.total_matches == 1


# -------------------------------------------------------------
# TEST 3: No Matches Found
# -------------------------------------------------------------
def test_03_no_matches_found(db):
    pat = db.query(Patient).filter(Patient.patient_code == "PAT-TEST-01").first()
    res = search_patient_documents(db, pat, "cardiovascular")

    assert res.total_matches == 0
    assert res.matching_documents_count == 0
    assert len(res.results) == 0


# -------------------------------------------------------------
# TEST 4: Multiple Occurrences in Single Document
# -------------------------------------------------------------
def test_04_multiple_occurrences_single_doc(db):
    pat = Patient(patient_code="PAT-TEST-04", display_name="Test Patient 4")
    db.add(pat)
    db.commit()

    # Contains term 5 times
    text = (
        "Note 1: allergies are severe.\n"
        "Note 2: no food allergies.\n"
        "Note 3: seasonal allergies present.\n"
        "Note 4: tested for allergies.\n"
        "Note 5: family history of allergies.\n"
    )
    stored_name, safe_orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "notes.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=safe_orig, stored_filename=stored_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    res = search_patient_documents(db, pat, "allergies")
    assert res.total_matches == 5
    assert len(res.results) == 5


# -------------------------------------------------------------
# TEST 5: Multiple Documents per Patient
# -------------------------------------------------------------
def test_05_multiple_documents_search(db):
    pat = Patient(patient_code="PAT-TEST-05", display_name="Test Patient 5")
    db.add(pat)
    db.commit()

    # 5 reports, 3 contain "infection"
    docs_text = [
        ("report1.txt", "Active viral infection detected."),
        ("report2.txt", "Blood count normal, no infection."),
        ("report3.txt", "Routine checkup, vital signs stable."),
        ("report4.txt", "Skin infection resolved with topical cream."),
        ("report5.txt", "Discharge instructions completed.")
    ]

    for fname, txt in docs_text:
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt.encode("utf-8"), fname, pat.id)
        d = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        db.add(d)
        db.commit()
        process_document(db, d.id)

    res = search_patient_documents(db, pat, "infection")
    assert res.total_matches == 3
    assert res.matching_documents_count == 3
    doc_names = {r.document_filename for r in res.results}
    assert doc_names == {"report1.txt", "report2.txt", "report4.txt"}


# -------------------------------------------------------------
# TEST 6: Patient Data Isolation
# -------------------------------------------------------------
def test_06_patient_isolation(db):
    patA = Patient(patient_code="PAT-ISO-A", display_name="Patient A")
    patB = Patient(patient_code="PAT-ISO-B", display_name="Patient B")
    db.add_all([patA, patB])
    db.commit()

    # PatA has document with 'asthma'
    s_nameA, origA, ftypeA, fsizeA, fhashA = store_uploaded_file(b"Patient A has chronic asthma.", "docA.txt", patA.id)
    docA = Document(patient_id=patA.id, original_filename=origA, stored_filename=s_nameA, file_type=ftypeA, file_size=fsizeA, file_hash=fhashA)

    # PatB has document with 'asthma'
    s_nameB, origB, ftypeB, fsizeB, fhashB = store_uploaded_file(b"Patient B has asthma and eczema.", "docB.txt", patB.id)
    docB = Document(patient_id=patB.id, original_filename=origB, stored_filename=s_nameB, file_type=ftypeB, file_size=fsizeB, file_hash=fhashB)

    # PatB also has document with 'leukemia'
    s_nameB2, origB2, ftypeB2, fsizeB2, fhashB2 = store_uploaded_file(b"Screening for leukemia negative.", "docB2.txt", patB.id)
    docB2 = Document(patient_id=patB.id, original_filename=origB2, stored_filename=s_nameB2, file_type=ftypeB2, file_size=fsizeB2, file_hash=fhashB2)

    db.add_all([docA, docB, docB2])
    db.commit()
    process_document(db, docA.id)
    process_document(db, docB.id)
    process_document(db, docB2.id)

    # Searching PatA for 'asthma' must return only docA
    resA = search_patient_documents(db, patA, "asthma")
    assert resA.total_matches == 1
    assert resA.results[0].document_filename == "docA.txt"

    # Searching PatA for 'leukemia' must return 0 matches
    resA_leuk = search_patient_documents(db, patA, "leukemia")
    assert resA_leuk.total_matches == 0

    # Searching PatB for 'leukemia' must return docB2
    resB_leuk = search_patient_documents(db, patB, "leukemia")
    assert resB_leuk.total_matches == 1
    assert resB_leuk.results[0].document_filename == "docB2.txt"


# -------------------------------------------------------------
# TEST 7: PDF Page Extraction & Exact Page Number Identification
# -------------------------------------------------------------
def test_07_pdf_page_identification(db):
    pat = Patient(patient_code="PAT-PDF-07", display_name="PDF Test Patient")
    db.add(pat)
    db.commit()

    # Create a 3-page PDF:
    # Page 1: General info
    # Page 2: Contains target word "penicillin"
    # Page 3: Discharge info
    pdf_bytes = create_pdf_bytes([
        ["CLINICAL ADMISSION", "Patient registered for evaluation.", "No acute distress."],
        ["MEDICATION RECONCILIATION", "Known severe adverse reaction to penicillin.", "Do not administer."],
        ["DISCHARGE PLAN", "Follow-up scheduled in 14 days."]
    ])

    s_name, orig, ftype, fsize, fhash = store_uploaded_file(pdf_bytes, "Allergy_Report.pdf", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    processed = process_document(db, doc.id)

    assert processed.processing_status == "completed"
    assert processed.page_count == 3

    res = search_patient_documents(db, pat, "penicillin")
    assert res.total_matches == 1
    assert res.results[0].page_number == 2
    assert res.results[0].document_filename == "Allergy_Report.pdf"


# -------------------------------------------------------------
# TEST 8: DOCX Extraction
# -------------------------------------------------------------
def test_08_docx_extraction(db):
    pat = Patient(patient_code="PAT-DOCX-08", display_name="DOCX Test Patient")
    db.add(pat)
    db.commit()

    docx_path = os.path.join(TEST_STORAGE_DIR, "temp_test.docx")
    write_sample_docx(docx_path, [
        "Patient Consultation Summary",
        "The patient presents with severe osteoarthritis in the right knee.",
        "Physical therapy recommended twice weekly."
    ])

    with open(docx_path, "rb") as f:
        content = f.read()

    s_name, orig, ftype, fsize, fhash = store_uploaded_file(content, "Consultation.docx", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    processed = process_document(db, doc.id)

    assert processed.processing_status == "completed"

    res = search_patient_documents(db, pat, "osteoarthritis")
    assert res.total_matches == 1
    assert res.results[0].document_filename == "Consultation.docx"


# -------------------------------------------------------------
# TEST 9: TXT Extraction with Multiple Sections
# -------------------------------------------------------------
def test_09_txt_extraction_multiple_terms(db):
    pat = Patient(patient_code="PAT-TXT-09", display_name="TXT Multi Patient")
    db.add(pat)
    db.commit()

    txt_content = (
        "SECTION 1: Patient diagnosed with bronchitis.\n\n"
        "SECTION 2: Antibiotics prescribed for bronchitis treatment.\n\n"
        "SECTION 3: Follow-up required if bronchitis does not improve."
    )
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt_content.encode("utf-8"), "Bronchitis_Notes.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    res = search_patient_documents(db, pat, "bronchitis")
    assert res.total_matches == 3
    assert len(res.results) == 3


# -------------------------------------------------------------
# TEST 10: Multi-Word Phrase Search
# -------------------------------------------------------------
def test_10_phrase_search(db):
    pat = Patient(patient_code="PAT-PHRASE-10", display_name="Phrase Patient")
    db.add(pat)
    db.commit()

    text = "Resting blood pressure measured at 130/85 mmHg. Daily blood pressure tracking requested."
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "vitals.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    res = search_patient_documents(db, pat, "blood pressure")
    assert res.total_matches == 2
    assert res.results[0].matched_text.lower() == "blood pressure"


# -------------------------------------------------------------
# TEST 11: Singular and Plural Flexible Matching
# -------------------------------------------------------------
def test_11_singular_plural_matching(db):
    pat = Patient(patient_code="PAT-FLEX-11", display_name="Flexible Match Patient")
    db.add(pat)
    db.commit()

    text = "The allergy panel was negative, but allergies were observed in spring."
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "allergy.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    # Exact search for 'allergy' finds 1 occurrence ('allergy')
    res_exact = search_patient_documents(db, pat, "allergy", mode="exact")
    assert res_exact.total_matches == 1

    # Flexible search for 'allergy' finds both 'allergy' and 'allergies' (2 occurrences)
    res_flex = search_patient_documents(db, pat, "allergy", mode="flexible")
    assert res_flex.total_matches == 2


# -------------------------------------------------------------
# TEST 12: Repeated Searches Without Stale Results
# -------------------------------------------------------------
def test_12_repeated_searches_clean(db):
    pat = db.query(Patient).filter(Patient.patient_code == "PAT-FLEX-11").first()

    # Search 1: allergy
    res1 = search_patient_documents(db, pat, "allergy", mode="exact")
    assert res1.total_matches == 1

    # Search 2: unrelated word
    res2 = search_patient_documents(db, pat, "diabetes", mode="exact")
    assert res2.total_matches == 0
    assert len(res2.results) == 0


# -------------------------------------------------------------
# TEST 13: File Deletion Removes Indexed Text
# -------------------------------------------------------------
def test_13_file_deletion_cleanup(db):
    from backend.app.services.document_processing import delete_document_file_and_record

    pat = Patient(patient_code="PAT-DEL-13", display_name="Delete Test Patient")
    db.add(pat)
    db.commit()

    content = b"Temporary record with unique term zzz_rare_disease."
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(content, "temp_del.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    # Verify term exists
    res_before = search_patient_documents(db, pat, "zzz_rare_disease")
    assert res_before.total_matches == 1

    # Delete document
    delete_document_file_and_record(db, doc.id)

    # Search again: must be 0 matches
    res_after = search_patient_documents(db, pat, "zzz_rare_disease")
    assert res_after.total_matches == 0


# -------------------------------------------------------------
# TEST 14: Processing Failure Handling (Corrupted / Empty File)
# -------------------------------------------------------------
def test_14_corrupted_file_handling(db):
    pat = Patient(patient_code="PAT-CORR-14", display_name="Corrupt Test Patient")
    db.add(pat)
    db.commit()

    # Corrupted pseudo-PDF
    bad_pdf = b"%PDF-1.4\nCorrupted content without xref or valid objects"
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(bad_pdf, "bad.pdf", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    processed = process_document(db, doc.id)

    assert processed.processing_status == "failed"
    assert processed.processing_error is not None

    # Searching should return 0 matches and include warning about failed documents
    res = search_patient_documents(db, pat, "allergies")
    assert res.total_matches == 0
    assert res.failed_documents_count == 1
    assert any("failed processing" in w for w in res.warnings)


# -------------------------------------------------------------
# TEST 15: OCR Availability and Transparent Reporting
# -------------------------------------------------------------
def test_15_ocr_detection():
    is_ready, engine_desc = is_ocr_available()
    assert isinstance(is_ready, bool)
    assert isinstance(engine_desc, str)
    # The application must report truthfully rather than fabricating OCR availability
    if not is_ready:
        assert "not installed" in engine_desc.lower()


# -------------------------------------------------------------
# TEST 16: Special Characters, Punctuation, and HTML Safety
# -------------------------------------------------------------
def test_16_special_characters_and_safety(db):
    pat = Patient(patient_code="PAT-SAFE-16", display_name="Safety Patient")
    db.add(pat)
    db.commit()

    text = "Patient evaluated for COVID-19; lab values: <HbA1c & glucose> normal, O2 sat > 98%."
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "safety.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    res = search_patient_documents(db, pat, "COVID-19")
    assert res.total_matches == 1
    assert res.results[0].matched_text == "COVID-19"


# -------------------------------------------------------------
# TEST 17: Pagination of Large Occurrence Sets
# -------------------------------------------------------------
def test_17_pagination(db):
    pat = Patient(patient_code="PAT-PAGE-17", display_name="Pagination Patient")
    db.add(pat)
    db.commit()

    # Generate 25 occurrences
    text = " ".join([f"Case {i}: hypertension recorded." for i in range(1, 26)])
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "page_test.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    # Page 1 (size 10)
    p1 = search_patient_documents(db, pat, "hypertension", page=1, page_size=10)
    assert p1.total_matches == 25
    assert len(p1.results) == 10
    assert p1.total_pages == 3

    # Page 3 (size 10) -> last 5
    p3 = search_patient_documents(db, pat, "hypertension", page=3, page_size=10)
    assert len(p3.results) == 5


# -------------------------------------------------------------
# TEST 18: Whole-Word Matching (Prevent false substring hits)
# -------------------------------------------------------------
def test_18_prevent_false_substring_matches(db):
    pat = Patient(patient_code="PAT-WORD-18", display_name="Boundary Patient")
    db.add(pat)
    db.commit()

    # Document has "category" and "concatenation", but NOT "cat"
    text = "Clinical category classification and concatenation of records."
    s_name, orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "words.txt", pat.id)
    doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
    db.add(doc)
    db.commit()
    process_document(db, doc.id)

    # Search for 'cat' must NOT match 'category' or 'concatenation'
    res = search_patient_documents(db, pat, "cat")
    assert res.total_matches == 0
