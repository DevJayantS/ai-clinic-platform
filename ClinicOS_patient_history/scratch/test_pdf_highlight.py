import os
import re
import pypdf
from pypdf.generic import (
    DictionaryObject,
    NameObject,
    ArrayObject,
    FloatObject,
    NumberObject,
    create_string_object
)

def highlight_pdf(input_pdf_path: str, output_pdf_path: str, search_word: str):
    reader = pypdf.PdfReader(input_pdf_path)
    writer = pypdf.PdfWriter()

    total_highlights = 0

    for p_idx, page in enumerate(reader.pages):
        writer.add_page(page)
        target_page = writer.pages[p_idx]

        spans = []
        def visitor(text, cm, tm, font_dict, font_size):
            if not text:
                return
            x = tm[4]
            y = tm[5]
            fs = font_size if font_size else 10.0
            spans.append({'text': text, 'x': x, 'y': y, 'font_size': fs})

        page.extract_text(visitor_text=visitor)

        pattern = re.compile(re.escape(search_word), re.IGNORECASE)
        page_highlights = []

        for span in spans:
            stext = span['text']
            for m in pattern.finditer(stext):
                start_idx, end_idx = m.span()
                char_w = span['font_size'] * 0.52
                word_x = span['x'] + (start_idx * char_w)
                word_w = (end_idx - start_idx) * char_w
                word_y = span['y'] - 2
                word_h = span['font_size'] * 1.25

                # Coordinates: x1, y1 (bottom-left) to x2, y2 (top-right)
                x1 = word_x
                y1 = word_y
                x2 = word_x + word_w
                y2 = word_y + word_h

                # Standard PDF QuadPoints: (x1, y2, x2, y2, x1, y1, x2, y1)
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

                # PDF Highlight Annotation
                annot = DictionaryObject({
                    NameObject('/Type'): NameObject('/Annot'),
                    NameObject('/Subtype'): NameObject('/Highlight'),
                    NameObject('/Rect'): ArrayObject(rect),
                    NameObject('/QuadPoints'): ArrayObject(quad_points),
                    NameObject('/C'): ArrayObject([FloatObject(1.0), FloatObject(0.92), FloatObject(0.23)]), # Bright warm yellow
                    NameObject('/T'): create_string_object("Search Match"),
                    NameObject('/Contents'): create_string_object(f"Search match for: {search_word}"),
                    NameObject('/F'): NumberObject(4) # Print flag
                })

                page_highlights.append(annot)
                total_highlights += 1

        if page_highlights:
            if '/Annots' not in target_page:
                target_page[NameObject('/Annots')] = ArrayObject()
            for h in page_highlights:
                target_page['/Annots'].append(h)

    with open(output_pdf_path, 'wb') as f:
        writer.write(f)

    return total_highlights

pdf_in = 'sample_medical_reports/PAT-2001/PAT2001_Allergy_Panel_Report.pdf'
pdf_out = 'scratch/output_annotated.pdf'
count = highlight_pdf(pdf_in, pdf_out, 'allergy')
print(f'Done! Added {count} highlight annotations into {pdf_out}')
