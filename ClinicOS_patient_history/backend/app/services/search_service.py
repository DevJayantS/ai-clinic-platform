import re
import html
from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
from backend.app.models.models import Patient, Document, DocumentSegment
from backend.app.schemas.schemas import SearchOccurrence, SearchResponse

def get_word_variants(word: str) -> List[str]:
    """
    Generate common singular/plural variants for flexible matching mode.
    Works deterministically without external AI services.
    """
    w = word.strip().lower()
    variants = {w}

    # Irregular or Latin medical plurals
    irregulars = {
        "analysis": "analyses", "analyses": "analysis",
        "diagnosis": "diagnoses", "diagnoses": "diagnosis",
        "prognosis": "prognoses", "prognoses": "prognosis",
        "crisis": "crises", "crises": "crisis",
        "thrombus": "thrombi", "thrombi": "thrombus",
        "embolus": "emboli", "emboli": "embolus",
        "bronchus": "bronchi", "bronchi": "bronchus",
        "criterion": "criteria", "criteria": "criterion",
        "fungus": "fungi", "fungi": "fungus",
        "bacterium": "bacteria", "bacteria": "bacterium",
    }
    if w in irregulars:
        variants.add(irregulars[w])

    # Rule: -ies <-> -y (e.g., allergies <-> allergy, surgeries <-> surgery)
    if w.endswith("ies") and len(w) > 4:
        variants.add(w[:-3] + "y")
    elif w.endswith("y") and len(w) > 2 and w[-2] not in "aeiou":
        variants.add(w[:-1] + "ies")

    # Rule: -es (e.g., reflexes <-> reflex, rashes <-> rash)
    elif w.endswith("es") and len(w) > 3:
        variants.add(w[:-2])
        variants.add(w[:-1])

    # Rule: -s (e.g., infections <-> infection, treatments <-> treatment)
    elif w.endswith("s") and not w.endswith("ss") and len(w) > 2:
        variants.add(w[:-1])
    else:
        variants.add(w + "s")
        variants.add(w + "es")

    return list(variants)


def build_search_regex(query: str, mode: str = "exact") -> re.Pattern:
    """
    Construct a case-insensitive regex pattern enforcing word/phrase boundaries.
    Prevents false substring matches (e.g. 'cat' in 'category').
    """
    # Normalize internal whitespace
    tokens = [t.strip() for t in query.split() if t.strip()]
    if not tokens:
        raise ValueError("Search query cannot be empty.")

    if mode == "flexible" and len(tokens) == 1:
        # Flexible singular/plural matching for single word
        variants = get_word_variants(tokens[0])
        sub_patterns = [re.escape(v) for v in variants]
        pattern_str = r"(?<!\w)(?:" + "|".join(sub_patterns) + r")(?!\w)"
    else:
        # Exact word or phrase matching with flexible whitespace between tokens
        escaped_tokens = [re.escape(t) for t in tokens]
        phrase_body = r"\s+".join(escaped_tokens)
        pattern_str = rf"(?<!\w){phrase_body}(?!\w)"

    return re.compile(pattern_str, re.IGNORECASE)


def extract_context_excerpt(text: str, start: int, end: int, window: int = 90) -> str:
    """
    Extract a safe surrounding context window around the match with ellipsis.
    Never fabricates surrounding text; preserves actual extracted text.
    """
    text_len = len(text)
    ctx_start = max(0, start - window)
    ctx_end = min(text_len, end + window)

    # Attempt to align to word boundaries
    if ctx_start > 0:
        prev_space = text.rfind(" ", 0, start)
        if prev_space > ctx_start:
            ctx_start = prev_space + 1
        elif text.find(" ", ctx_start, start) != -1:
            ctx_start = text.find(" ", ctx_start, start) + 1

    if ctx_end < text_len:
        next_space = text.find(" ", end)
        if next_space != -1 and next_space < ctx_end + 30:
            ctx_end = next_space

    snippet = text[ctx_start:ctx_end].replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    # Collapse consecutive spaces
    snippet = " ".join(snippet.split())

    prefix = "..." if ctx_start > 0 else ""
    suffix = "..." if ctx_end < text_len else ""
    return f"{prefix}{snippet}{suffix}"


def search_patient_documents(
    db: Session,
    patient: Patient,
    query: str,
    mode: str = "exact",
    page: int = 1,
    page_size: int = 20
) -> SearchResponse:
    """
    Patient-scoped search engine.
    Searches only documents belonging to the given patient.
    Returns all occurrences with document, page/paragraph, context, and offsets.
    """
    clean_query = query.strip()
    if not clean_query:
        return SearchResponse(
            patient_id=patient.id,
            patient_code=patient.patient_code,
            patient_name=patient.display_name,
            query=clean_query,
            mode=mode,
            total_matches=0,
            matching_documents_count=0,
            total_searched_documents=0,
            processing_documents_count=0,
            failed_documents_count=0,
            page=1,
            page_size=page_size,
            total_pages=1,
            results=[],
            warnings=["Search query was empty."]
        )

    # 1. Inspect all patient documents and their statuses
    all_docs = db.query(Document).filter(Document.patient_id == patient.id).all()
    total_docs = len(all_docs)
    completed_docs = [d for d in all_docs if d.processing_status in ("completed", "partially_completed")]
    processing_docs = [d for d in all_docs if d.processing_status in ("pending", "processing")]
    failed_docs = [d for d in all_docs if d.processing_status == "failed"]

    warnings: List[str] = []
    if processing_docs:
        warnings.append(
            f"{len(processing_docs)} document(s) are currently still processing and could not be searched yet."
        )
    if failed_docs:
        warnings.append(
            f"{len(failed_docs)} document(s) failed processing and could not be indexed."
        )

    if not completed_docs:
        return SearchResponse(
            patient_id=patient.id,
            patient_code=patient.patient_code,
            patient_name=patient.display_name,
            query=clean_query,
            mode=mode,
            total_matches=0,
            matching_documents_count=0,
            total_searched_documents=0,
            processing_documents_count=len(processing_docs),
            failed_documents_count=len(failed_docs),
            page=1,
            page_size=page_size,
            total_pages=1,
            results=[],
            warnings=warnings
        )

    completed_doc_ids = [d.id for d in completed_docs]
    doc_map = {d.id: d for d in completed_docs}

    # 2. Compile search regex
    try:
        search_regex = build_search_regex(clean_query, mode=mode)
    except Exception as e:
        return SearchResponse(
            patient_id=patient.id,
            patient_code=patient.patient_code,
            patient_name=patient.display_name,
            query=clean_query,
            mode=mode,
            total_matches=0,
            matching_documents_count=0,
            total_searched_documents=len(completed_docs),
            processing_documents_count=len(processing_docs),
            failed_documents_count=len(failed_docs),
            page=1,
            page_size=page_size,
            total_pages=1,
            results=[],
            warnings=[f"Invalid search pattern: {str(e)}"]
        )

    # 3. Retrieve all segments for eligible documents belonging ONLY to this patient
    segments = (
        db.query(DocumentSegment)
        .filter(DocumentSegment.document_id.in_(completed_doc_ids))
        .order_by(DocumentSegment.document_id.asc(), DocumentSegment.page_number.asc(), DocumentSegment.id.asc())
        .all()
    )

    all_occurrences: List[SearchOccurrence] = []
    matching_doc_ids = set()

    for seg in segments:
        text = seg.content
        doc = doc_map.get(seg.document_id)
        if not doc:
            continue

        for match in search_regex.finditer(text):
            start = match.start()
            end = match.end()
            matched_str = text[start:end]
            matching_doc_ids.add(doc.id)

            excerpt = extract_context_excerpt(text, start, end)
            occ_id = f"doc_{doc.id}_seg_{seg.id}_p{seg.page_number}_idx_{start}"

            all_occurrences.append(
                SearchOccurrence(
                    occurrence_id=occ_id,
                    document_id=doc.id,
                    document_filename=doc.original_filename,
                    file_type=doc.file_type,
                    page_number=seg.page_number,
                    segment_type=seg.segment_type,
                    matched_text=matched_str,
                    context_excerpt=excerpt,
                    start_offset=start,
                    end_offset=end,
                    extraction_method=seg.extraction_method
                )
            )

    total_matches = len(all_occurrences)
    matching_docs_count = len(matching_doc_ids)

    # 4. Pagination
    if page_size <= 0:
        page_size = 20
    total_pages = max(1, (total_matches + page_size - 1) // page_size)
    if page < 1:
        page = 1

    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paged_results = all_occurrences[start_idx:end_idx]

    return SearchResponse(
        patient_id=patient.id,
        patient_code=patient.patient_code,
        patient_name=patient.display_name,
        query=clean_query,
        mode=mode,
        total_matches=total_matches,
        matching_documents_count=matching_docs_count,
        total_searched_documents=len(completed_docs),
        processing_documents_count=len(processing_docs),
        failed_documents_count=len(failed_docs),
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        results=paged_results,
        warnings=warnings
    )
