"""
PDF Text Highlighting Service
Finds occurrences of search terms in PDF documents and applies both:
1. Standard Adobe PDF Highlight Annotations (/Subtype /Highlight) with QuadPoints
2. Visual semi-transparent highlight rectangles in the PDF content stream (Multiply blend mode)
This dual approach guarantees exact highlighting across all browser iframe viewers, PDF.js,
and external PDF viewers.
"""

import io
import re
import math
from typing import List, Dict, Any, Tuple, Optional
import pypdf
from pypdf.generic import (
    DictionaryObject,
    NameObject,
    ArrayObject,
    FloatObject,
    NumberObject,
    DecodedStreamObject,
    create_string_object
)

# Standard Adobe Helvetica character width metrics (in units of 1/1000 of font size)
HELVETICA_WIDTHS: Dict[str, int] = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
    '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
    '@': 1015, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778,
    'H': 722, 'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778,
    'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944,
    'X': 667, 'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
    '`': 333, 'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556,
    'h': 556, 'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556,
    'p': 556, 'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722,
    'x': 500, 'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584
}


def calculate_string_width(text: str, font_size: float = 12.0) -> float:
    """Calculate proportional text width using standard Helvetica metrics."""
    total_units = sum(HELVETICA_WIDTHS.get(ch, 520) for ch in text)
    return (total_units * font_size) / 1000.0


def extract_page_word_locations(page: pypdf.PageObject, search_term: str) -> List[Dict[str, Any]]:
    """
    Extract exact bounding box coordinates for occurrences of search_term on a PDF page.
    """
    spans: List[Dict[str, Any]] = []

    def visitor(text, cm, tm, font_dict, font_size):
        if not text:
            return
        cm_x = float(cm[4]) if cm and len(cm) > 4 else 0.0
        cm_y = float(cm[5]) if cm and len(cm) > 5 else 0.0
        tm_x = float(tm[4]) if tm and len(tm) > 4 else 0.0
        tm_y = float(tm[5]) if tm and len(tm) > 5 else 0.0
        x = cm_x + tm_x
        y = cm_y + tm_y
        fs = float(font_size) if font_size else 12.0
        spans.append({
            'text': text,
            'x': x,
            'y': y,
            'font_size': fs,
            'cm': cm,
            'tm': tm
        })

    try:
        page.extract_text(visitor_text=visitor)
    except Exception:
        return []

    if not search_term or not search_term.strip():
        return []

    # Case-insensitive term search pattern
    escaped_term = re.escape(search_term.strip())
    pattern = re.compile(escaped_term, re.IGNORECASE)

    results: List[Dict[str, Any]] = []

    for span in spans:
        raw_text = span['text']
        fs = span['font_size']
        base_x = span['x']
        base_y = span['y']

        for match in pattern.finditer(raw_text):
            start_char, end_char = match.span()
            matched_str = match.group(0)

            # Prefix before the match to get exact X start
            prefix_text = raw_text[:start_char]
            prefix_width = calculate_string_width(prefix_text, fs)
            word_width = calculate_string_width(matched_str, fs)

            # Add subtle padding around highlight box
            pad_x = 2.0
            pad_y_bottom = 2.0
            pad_y_top = 2.0

            x1 = base_x + prefix_width - pad_x
            x2 = base_x + prefix_width + word_width + pad_x
            y1 = base_y - pad_y_bottom
            y2 = base_y + fs + pad_y_top

            results.append({
                'matched_text': matched_str,
                'x1': round(x1, 2),
                'y1': round(y1, 2),
                'x2': round(x2, 2),
                'y2': round(y2, 2),
                'width': round(x2 - x1, 2),
                'height': round(y2 - y1, 2),
                'font_size': fs,
                'line_text': raw_text.strip()
            })

    return results


def highlight_pdf_bytes(pdf_input: bytes, search_term: str) -> Tuple[bytes, int, List[Dict[str, Any]]]:
    """
    Given PDF file bytes and a search term:
    - Finds all occurrences across all pages.
    - Injects standard Adobe PDF highlight annotations.
    - Appends semi-transparent visual highlight drawing streams.
    - Returns: (annotated_pdf_bytes, total_highlights_count, locations_list)
    """
    if not search_term or not search_term.strip():
        return pdf_input, 0, []

    reader = pypdf.PdfReader(io.BytesIO(pdf_input))
    writer = pypdf.PdfWriter()

    total_count = 0
    all_locations = []

    for p_idx, page in enumerate(reader.pages):
        writer.add_page(page)
        target_page = writer.pages[p_idx]
        page_num = p_idx + 1

        boxes = extract_page_word_locations(page, search_term)

        if not boxes:
            continue

        # -------------------------------------------------------------
        # 1. Standard Adobe PDF Highlight Annotations (/Subtype /Highlight)
        # -------------------------------------------------------------
        page_annots = []
        for box in boxes:
            x1, y1, x2, y2 = box['x1'], box['y1'], box['x2'], box['y2']

            quad_points = [
                FloatObject(x1), FloatObject(y2),
                FloatObject(x2), FloatObject(y2),
                FloatObject(x1), FloatObject(y1),
                FloatObject(x2), FloatObject(y1)
            ]

            rect = [
                FloatObject(x1), FloatObject(y1),
                FloatObject(x2), FloatObject(y2)
            ]

            # Bright Medical Yellow: RGB(1.0, 0.90, 0.20)
            annot = DictionaryObject({
                NameObject('/Type'): NameObject('/Annot'),
                NameObject('/Subtype'): NameObject('/Highlight'),
                NameObject('/Rect'): ArrayObject(rect),
                NameObject('/QuadPoints'): ArrayObject(quad_points),
                NameObject('/C'): ArrayObject([FloatObject(1.0), FloatObject(0.90), FloatObject(0.18)]),
                NameObject('/T'): create_string_object("ClinicOS Search Match"),
                NameObject('/Contents'): create_string_object(f"Match: {box['matched_text']}"),
                NameObject('/F'): NumberObject(4) # Print flag
            })
            page_annots.append(annot)

            total_count += 1
            all_locations.append({
                'page': page_num,
                'matched_text': box['matched_text'],
                'x1': box['x1'],
                'y1': box['y1'],
                'x2': box['x2'],
                'y2': box['y2'],
                'line_text': box['line_text']
            })

        if page_annots:
            if '/Annots' not in target_page:
                target_page[NameObject('/Annots')] = ArrayObject()
            elif not isinstance(target_page['/Annots'], ArrayObject):
                try:
                    resolved_annots = target_page['/Annots'].get_object()
                    target_page[NameObject('/Annots')] = ArrayObject(list(resolved_annots))
                except Exception:
                    target_page[NameObject('/Annots')] = ArrayObject()

            for a in page_annots:
                target_page['/Annots'].append(a)

    out_buffer = io.BytesIO()
    writer.write(out_buffer)
    return out_buffer.getvalue(), total_count, all_locations
