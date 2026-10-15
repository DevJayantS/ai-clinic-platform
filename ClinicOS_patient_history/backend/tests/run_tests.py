import os
import sys
import shutil
import unittest

# Ensure root directory is on PYTHONPATH
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.session import Base
from backend.app.models.models import Patient, Document, DocumentSegment
from backend.app.services.document_processing import store_uploaded_file, process_document, delete_document_file_and_record
from backend.app.services.search_service import search_patient_documents
from backend.app.services.ocr_service import is_ocr_available
from backend.synthetic_data_generator import create_pdf_bytes, write_sample_docx

TEST_DB_PATH = os.path.join(settings.BASE_DIR, "storage", "unittest_search.db")
TEST_STORAGE_DIR = os.path.join(settings.BASE_DIR, "storage", "unittest_documents")

test_engine = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

class MedicalDocumentSearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.makedirs(TEST_STORAGE_DIR, exist_ok=True)
        settings.STORAGE_DIR = TEST_STORAGE_DIR
        Base.metadata.drop_all(bind=test_engine)
        Base.metadata.create_all(bind=test_engine)

    @classmethod
    def tearDownClass(cls):
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

    def setUp(self):
        self.db = TestSessionLocal()

    def tearDown(self):
        self.db.close()

    def test_01_basic_word_search(self):
        pat = Patient(patient_code="PAT-UT-01", display_name="Test Patient 1")
        self.db.add(pat)
        self.db.commit()

        content = b"The patient has a history of allergies recorded."
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(content, "history.txt", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res = search_patient_documents(self.db, pat, "allergies")
        self.assertEqual(res.total_matches, 1)
        self.assertEqual(res.matching_documents_count, 1)
        self.assertEqual(res.results[0].document_filename, "history.txt")

    def test_02_case_insensitive_search(self):
        pat = self.db.query(Patient).filter(Patient.patient_code == "PAT-UT-01").first()
        res_upper = search_patient_documents(self.db, pat, "ALLERGIES")
        res_mixed = search_patient_documents(self.db, pat, "AllErGies")
        self.assertEqual(res_upper.total_matches, 1)
        self.assertEqual(res_mixed.total_matches, 1)

    def test_03_no_matches(self):
        pat = self.db.query(Patient).filter(Patient.patient_code == "PAT-UT-01").first()
        res = search_patient_documents(self.db, pat, "cardiovascular")
        self.assertEqual(res.total_matches, 0)
        self.assertEqual(len(res.results), 0)

    def test_04_multiple_occurrences(self):
        pat = Patient(patient_code="PAT-UT-04", display_name="Multi Occur Patient")
        self.db.add(pat)
        self.db.commit()

        text = "allergies 1, allergies 2, allergies 3, allergies 4, allergies 5."
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(text.encode("utf-8"), "multi.txt", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res = search_patient_documents(self.db, pat, "allergies")
        self.assertEqual(res.total_matches, 5)
        self.assertEqual(len(res.results), 5)

    def test_05_multiple_documents(self):
        pat = Patient(patient_code="PAT-UT-05", display_name="Multi Doc Patient")
        self.db.add(pat)
        self.db.commit()

        docs = [
            ("doc1.txt", "Active viral infection detected."),
            ("doc2.txt", "Normal blood count, no infection."),
            ("doc3.txt", "Follow-up for previous infection.")
        ]
        for fname, txt in docs:
            s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt.encode("utf-8"), fname, pat.id)
            d = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
            self.db.add(d)
            self.db.commit()
            process_document(self.db, d.id)

        res = search_patient_documents(self.db, pat, "infection")
        self.assertEqual(res.total_matches, 3)
        self.assertEqual(res.matching_documents_count, 3)

    def test_06_patient_isolation(self):
        patA = Patient(patient_code="PAT-ISO-1", display_name="Patient 1")
        patB = Patient(patient_code="PAT-ISO-2", display_name="Patient 2")
        self.db.add_all([patA, patB])
        self.db.commit()

        sA, oA, tA, zA, hA = store_uploaded_file(b"Report for Patient 1: diabetes mellitus.", "docA.txt", patA.id)
        dA = Document(patient_id=patA.id, original_filename=oA, stored_filename=sA, file_type=tA, file_size=zA, file_hash=hA)

        sB, oB, tB, zB, hB = store_uploaded_file(b"Report for Patient 2: diabetes mellitus and asthma.", "docB.txt", patB.id)
        dB = Document(patient_id=patB.id, original_filename=oB, stored_filename=sB, file_type=tB, file_size=zB, file_hash=hB)

        self.db.add_all([dA, dB])
        self.db.commit()
        process_document(self.db, dA.id)
        process_document(self.db, dB.id)

        # Searching Patient 1 for diabetes must return only docA
        resA = search_patient_documents(self.db, patA, "diabetes")
        self.assertEqual(resA.total_matches, 1)
        self.assertEqual(resA.results[0].document_filename, "docA.txt")

        # Searching Patient 1 for asthma must return 0
        resA_asthma = search_patient_documents(self.db, patA, "asthma")
        self.assertEqual(resA_asthma.total_matches, 0)

        # Searching Patient 2 for asthma must return docB
        resB_asthma = search_patient_documents(self.db, patB, "asthma")
        self.assertEqual(resB_asthma.total_matches, 1)
        self.assertEqual(resB_asthma.results[0].document_filename, "docB.txt")

    def test_07_pdf_page_identification(self):
        pat = Patient(patient_code="PAT-PDF-UT", display_name="PDF Patient")
        self.db.add(pat)
        self.db.commit()

        pdf_bytes = create_pdf_bytes([
            ["Page One Header", "Normal evaluation."],
            ["Page Two Header", "Adverse allergy reaction to penicillin recorded here."],
            ["Page Three Header", "Discharge instructions."]
        ])
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(pdf_bytes, "Evaluation.pdf", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res = search_patient_documents(self.db, pat, "penicillin")
        self.assertEqual(res.total_matches, 1)
        self.assertEqual(res.results[0].page_number, 2)
        self.assertEqual(res.results[0].document_filename, "Evaluation.pdf")

    def test_08_docx_extraction(self):
        pat = Patient(patient_code="PAT-DOCX-UT", display_name="DOCX Patient")
        self.db.add(pat)
        self.db.commit()

        docx_path = os.path.join(TEST_STORAGE_DIR, "ut_consult.docx")
        write_sample_docx(docx_path, [
            "Clinical Consultation",
            "Confirmed diagnosis of acute gastroenteritis.",
            "Rehydration therapy initiated."
        ])
        with open(docx_path, "rb") as f:
            content = f.read()

        s_name, orig, ftype, fsize, fhash = store_uploaded_file(content, "Consult.docx", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res = search_patient_documents(self.db, pat, "gastroenteritis")
        self.assertEqual(res.total_matches, 1)
        self.assertEqual(res.results[0].document_filename, "Consult.docx")

    def test_09_phrase_search(self):
        pat = Patient(patient_code="PAT-PHRASE-UT", display_name="Phrase Patient")
        self.db.add(pat)
        self.db.commit()

        txt = "Continuous blood pressure monitoring was maintained."
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt.encode("utf-8"), "vitals.txt", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res = search_patient_documents(self.db, pat, "blood pressure")
        self.assertEqual(res.total_matches, 1)
        self.assertEqual(res.results[0].matched_text.lower(), "blood pressure")

    def test_10_singular_plural_matching(self):
        pat = Patient(patient_code="PAT-FLEX-UT", display_name="Flex Patient")
        self.db.add(pat)
        self.db.commit()

        txt = "One allergy was recorded; seasonal allergies were noted."
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt.encode("utf-8"), "flex.txt", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res_exact = search_patient_documents(self.db, pat, "allergy", mode="exact")
        self.assertEqual(res_exact.total_matches, 1)

        res_flex = search_patient_documents(self.db, pat, "allergy", mode="flexible")
        self.assertEqual(res_flex.total_matches, 2)

    def test_11_deletion_cleanup(self):
        pat = Patient(patient_code="PAT-DEL-UT", display_name="Del Patient")
        self.db.add(pat)
        self.db.commit()

        txt = "Temporary record containing target_unique_marker."
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt.encode("utf-8"), "del.txt", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res1 = search_patient_documents(self.db, pat, "target_unique_marker")
        self.assertEqual(res1.total_matches, 1)

        delete_document_file_and_record(self.db, doc.id)

        res2 = search_patient_documents(self.db, pat, "target_unique_marker")
        self.assertEqual(res2.total_matches, 0)

    def test_12_prevent_false_substring_matches(self):
        pat = Patient(patient_code="PAT-SUB-UT", display_name="Substring Patient")
        self.db.add(pat)
        self.db.commit()

        txt = "Categorization of records and clinical concatenation."
        s_name, orig, ftype, fsize, fhash = store_uploaded_file(txt.encode("utf-8"), "cat.txt", pat.id)
        doc = Document(patient_id=pat.id, original_filename=orig, stored_filename=s_name, file_type=ftype, file_size=fsize, file_hash=fhash)
        self.db.add(doc)
        self.db.commit()
        process_document(self.db, doc.id)

        res = search_patient_documents(self.db, pat, "cat")
        self.assertEqual(res.total_matches, 0)

if __name__ == "__main__":
    unittest.main(verbosity=2)
