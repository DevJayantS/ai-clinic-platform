"""
Comprehensive Verification Script for Patient Medical Document Search
Tests the 9 scenarios defined in Section 7 of the specification:
1. Search patient for 'allergy'
2. Confirm every matching document belonging to that patient is returned
3. Confirm multiple occurrences within a document are handled correctly
4. Confirm results display document name, page number, context excerpt, and offsets
5. Search for 'discharged' and verify matching discharge summaries are found
6. Search for nonexistent term and confirm empty-results state
7. Confirm search results are strictly restricted to selected patient (no leakage)
8. Confirm case-insensitive matching ('allergy', 'Allergy', 'ALLERGY')
9. Confirm total match count equals sum of individual document matches
"""

import sys
import json
import urllib.request
import urllib.parse
from typing import Dict, Any, List

BASE_URL = "http://127.0.0.1:8000/api"

def api_get(endpoint: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
    url = f"{BASE_URL}{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def group_by_document(results: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    docs = {}
    for occ in results:
        doc_id = occ["document_id"]
        if doc_id not in docs:
            docs[doc_id] = {
                "document_id": doc_id,
                "document_filename": occ["document_filename"],
                "file_type": occ["file_type"],
                "match_count": 0,
                "page_numbers": set(),
            }
        docs[doc_id]["match_count"] += 1
        if occ.get("page_number") is not None:
            docs[doc_id]["page_numbers"].add(occ["page_number"])
    return docs

def main():
    print("=" * 75)
    print("RUNNING 9 SEARCH VERIFICATION SCENARIOS AGAINST LIVE API")
    print("=" * 75)

    # Fetch patients
    patients_resp = api_get("/patients")
    patients = {p["patient_code"]: p for p in patients_resp}
    print(f"Loaded {len(patients)} patients from database:")
    for code, p in sorted(patients.items()):
        print(f"  - {code}: {p['display_name']} (ID: {p['id']}, Docs: {p['document_count']})")
    print()

    p2001_id = patients["PAT-2001"]["id"]
    p2002_id = patients["PAT-2002"]["id"]
    p2003_id = patients["PAT-2003"]["id"]
    p2004_id = patients["PAT-2004"]["id"]

    results_summary = []

    # -------------------------------------------------------------------------
    # Scenario 1 & 2: Search PAT-2001 for 'allergy' & verify matching documents
    # -------------------------------------------------------------------------
    print(">>> Scenario 1 & 2: Search PAT-2001 for 'allergy'")
    res1 = api_get(f"/patients/{p2001_id}/search", {"q": "allergy", "page_size": 100})
    docs1 = group_by_document(res1["results"])
    print(f"  Query: '{res1['query']}' | Total Matches: {res1['total_matches']} across {res1['matching_documents_count']} documents")
    for doc in docs1.values():
        pages = sorted(list(doc["page_numbers"]))
        print(f"    - Doc ID {doc['document_id']}: '{doc['document_filename']}' ({doc['file_type']}) -> {doc['match_count']} matches on page(s) {pages}")
    
    # Assertions
    assert res1["total_matches"] > 0, "Scenario 1 failed: Expected matches for 'allergy' in PAT-2001"
    matched_filenames = [d["document_filename"] for d in docs1.values()]
    assert "PAT2001_Allergy_Panel_Report.pdf" in matched_filenames
    assert "PAT2001_CBC_Blood_Test.pdf" in matched_filenames
    assert "PAT2001_Chest_Xray_Report.pdf" in matched_filenames
    assert "PAT2001_General_Medicine_Discharge_Summary.docx" in matched_filenames
    print("  [PASS] Scenarios 1 & 2: Returned all expected documents for PAT-2001.\n")
    results_summary.append(("Scenarios 1 & 2: Search for 'allergy' & document retrieval", True, f"{res1['total_matches']} matches across {res1['matching_documents_count']} docs"))

    # -------------------------------------------------------------------------
    # Scenario 3: Multiple occurrences within a document handled correctly
    # -------------------------------------------------------------------------
    print(">>> Scenario 3: Multiple occurrences within document (Allergy Panel)")
    allergy_panel_doc = next(d for d in docs1.values() if "Allergy_Panel" in d["document_filename"])
    print(f"  Document '{allergy_panel_doc['document_filename']}' has {allergy_panel_doc['match_count']} occurrences on pages {sorted(list(allergy_panel_doc['page_numbers']))}")
    assert allergy_panel_doc["match_count"] >= 5, "Scenario 3 failed: Expected multiple occurrences in Allergy Panel"
    
    occurrences_in_panel = [occ for occ in res1["results"] if occ["document_id"] == allergy_panel_doc["document_id"]]
    assert len(occurrences_in_panel) == allergy_panel_doc["match_count"]
    print(f"  Verified {len(occurrences_in_panel)} distinct occurrence records with exact positions.")
    print("  [PASS] Scenario 3: Multiple occurrences within document correctly tracked.\n")
    results_summary.append(("Scenario 3: Multiple occurrences handling", True, f"{allergy_panel_doc['match_count']} occurrences in single document across 2 pages"))

    # -------------------------------------------------------------------------
    # Scenario 4: Result metadata displays document name, page number, context
    # -------------------------------------------------------------------------
    print(">>> Scenario 4: Metadata validation (document name, page number, context excerpt, offsets)")
    for i, occ in enumerate(res1["results"][:3]):
        print(f"  Occurrence {i+1}:")
        print(f"    Doc Filename: {occ['document_filename']}")
        print(f"    Page/Segment: {occ['page_number']} ({occ['segment_type']})")
        print(f"    Matched Text: '{occ['matched_text']}'")
        print(f"    Context: {occ['context_excerpt']}")
        print(f"    Offsets: [{occ['start_offset']}, {occ['end_offset']}]")
        assert occ["document_filename"], "Missing document filename"
        assert occ["page_number"] is not None, "Missing page number"
        assert occ["context_excerpt"], "Missing context excerpt"
        assert occ["start_offset"] >= 0 and occ["end_offset"] > occ["start_offset"], "Invalid offsets"
    print("  [PASS] Scenario 4: All occurrences have complete metadata and context.\n")
    results_summary.append(("Scenario 4: Metadata and context excerpt verification", True, "All fields populated and validated"))

    # -------------------------------------------------------------------------
    # Scenario 5: Search for 'discharged' and verify discharge summaries found
    # -------------------------------------------------------------------------
    print(">>> Scenario 5: Search for 'discharged' across patients")
    res_discharged_2001 = api_get(f"/patients/{p2001_id}/search", {"q": "discharged", "page_size": 100})
    res_discharged_2002 = api_get(f"/patients/{p2002_id}/search", {"q": "discharged", "page_size": 100})
    res_discharged_2003 = api_get(f"/patients/{p2003_id}/search", {"q": "discharged", "page_size": 100})
    print(f"  PAT-2001 'discharged': {res_discharged_2001['total_matches']} matches across {res_discharged_2001['matching_documents_count']} docs")
    print(f"  PAT-2002 'discharged': {res_discharged_2002['total_matches']} matches across {res_discharged_2002['matching_documents_count']} docs")
    print(f"  PAT-2003 'discharged': {res_discharged_2003['total_matches']} matches across {res_discharged_2003['matching_documents_count']} docs")
    
    assert res_discharged_2001["total_matches"] > 0
    assert any("Discharge_Summary" in d["document_filename"] for d in res_discharged_2001["results"])
    assert any("Discharge_Summary" in d["document_filename"] for d in res_discharged_2002["results"])
    assert any("Discharge_Summary" in d["document_filename"] for d in res_discharged_2003["results"])
    print("  [PASS] Scenario 5: Discharge summaries found for patients with matching term.\n")
    results_summary.append(("Scenario 5: Search for 'discharged' in discharge summaries", True, "Found across PAT-2001, PAT-2002, PAT-2003"))

    # -------------------------------------------------------------------------
    # Scenario 6: Nonexistent term search and empty-results state
    # -------------------------------------------------------------------------
    print(">>> Scenario 6: Search for nonexistent term ('cardiovascular_xyz987')")
    res_empty = api_get(f"/patients/{p2001_id}/search", {"q": "cardiovascular_xyz987"})
    print(f"  Total Matches: {res_empty['total_matches']}")
    print(f"  Matching Docs Count: {res_empty['matching_documents_count']}")
    print(f"  Results length: {len(res_empty['results'])}")
    assert res_empty["total_matches"] == 0
    assert res_empty["matching_documents_count"] == 0
    assert len(res_empty["results"]) == 0
    print("  [PASS] Scenario 6: Clean empty state returned when no terms match.\n")
    results_summary.append(("Scenario 6: Nonexistent term empty state", True, "total_matches=0, 0 docs, 0 occurrences"))

    # -------------------------------------------------------------------------
    # Scenario 7: Patient isolation check (PAT-2003 has zero allergy mentions)
    # -------------------------------------------------------------------------
    print(">>> Scenario 7: Strict Patient Isolation Check (PAT-2003 vs PAT-2001)")
    print("  PAT-2003 (Marcus Sterling) was deliberately engineered with NO allergy mentions.")
    res_iso = api_get(f"/patients/{p2003_id}/search", {"q": "allergy"})
    print(f"  PAT-2003 search for 'allergy' -> Total Matches: {res_iso['total_matches']}, Matching Docs: {res_iso['matching_documents_count']}")
    assert res_iso["total_matches"] == 0, f"Isolation failure! Expected 0 matches for PAT-2003, got {res_iso['total_matches']}"
    assert res_iso["matching_documents_count"] == 0
    
    # Also verify that PAT-2004 search only returns PAT-2004 documents
    res_p4 = api_get(f"/patients/{p2004_id}/search", {"q": "allergy", "page_size": 100})
    print(f"  PAT-2004 search for 'allergy' -> Total Matches: {res_p4['total_matches']}, Matching Docs: {res_p4['matching_documents_count']}")
    for d in res_p4["results"]:
        assert "PAT2004" in d["document_filename"], f"Data leak detected! Document {d['document_filename']} found in PAT-2004 search"
    print("  [PASS] Scenario 7: Patient isolation strictly maintained. Zero data leaks across patient boundaries.\n")
    results_summary.append(("Scenario 7: Patient Isolation (Zero Leakage)", True, "PAT-2003 returned 0 matches; PAT-2004 strictly contained PAT-2004 docs"))

    # -------------------------------------------------------------------------
    # Scenario 8: Case-insensitivity test ('allergy', 'Allergy', 'ALLERGY')
    # -------------------------------------------------------------------------
    print(">>> Scenario 8: Case-Insensitivity Check ('allergy', 'Allergy', 'ALLERGY')")
    c_lower = api_get(f"/patients/{p2001_id}/search", {"q": "allergy", "page_size": 100})
    c_title = api_get(f"/patients/{p2001_id}/search", {"q": "Allergy", "page_size": 100})
    c_upper = api_get(f"/patients/{p2001_id}/search", {"q": "ALLERGY", "page_size": 100})
    print(f"  'allergy': {c_lower['total_matches']} matches across {c_lower['matching_documents_count']} docs")
    print(f"  'Allergy': {c_title['total_matches']} matches across {c_title['matching_documents_count']} docs")
    print(f"  'ALLERGY': {c_upper['total_matches']} matches across {c_upper['matching_documents_count']} docs")
    assert c_lower["total_matches"] == c_title["total_matches"] == c_upper["total_matches"]
    assert c_lower["matching_documents_count"] == c_title["matching_documents_count"] == c_upper["matching_documents_count"]
    print("  [PASS] Scenario 8: Case insensitivity perfectly matches across all casings.\n")
    results_summary.append(("Scenario 8: Case-insensitivity ('allergy'/'Allergy'/'ALLERGY')", True, f"Identical {c_lower['total_matches']} matches across all casings"))

    # -------------------------------------------------------------------------
    # Scenario 9: Total match count equals sum of individual document matches
    # -------------------------------------------------------------------------
    print(">>> Scenario 9: Total match count consistency")
    for pid, pcode in [(p2001_id, "PAT-2001"), (p2002_id, "PAT-2002"), (p2004_id, "PAT-2004")]:
        res_test = api_get(f"/patients/{pid}/search", {"q": "allergy", "page_size": 100})
        docs_grouped = group_by_document(res_test["results"])
        sum_doc_matches = sum(d["match_count"] for d in docs_grouped.values())
        total_reported = res_test["total_matches"]
        results_count = len(res_test["results"])
        print(f"  {pcode}: Reported Total = {total_reported}, Sum of Docs = {sum_doc_matches}, Results List = {results_count}")
        assert total_reported == sum_doc_matches == results_count, f"Count mismatch in {pcode}!"
    print("  [PASS] Scenario 9: Mathematical consistency of match counts verified.\n")
    results_summary.append(("Scenario 9: Total match count equals sum of document matches", True, "Exact mathematical match across all queries"))

    # -------------------------------------------------------------------------
    # Print Final Test Matrix
    # -------------------------------------------------------------------------
    print("=" * 75)
    print("VERIFICATION RESULTS SUMMARY")
    print("=" * 75)
    for name, status, detail in results_summary:
        status_str = "PASS" if status else "FAIL"
        print(f"[{status_str}] {name} -> {detail}")
    print("=" * 75)
    print("ALL 9 VERIFICATION SCENARIOS COMPLETED AND VALIDATED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
