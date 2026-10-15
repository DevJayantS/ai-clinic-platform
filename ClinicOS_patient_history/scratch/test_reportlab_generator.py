import io
import os
import sys
sys.path.insert(0, os.path.abspath('.'))

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import pypdf
from backend.app.services.pdf_highlighter import highlight_pdf_bytes

buffer = io.BytesIO()
doc = SimpleDocTemplate(
    buffer,
    pagesize=letter,
    leftMargin=36,
    rightMargin=36,
    topMargin=36,
    bottomMargin=36
)

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    'HospitalTitle',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=14,
    leading=17,
    textColor=colors.HexColor('#0f2942')
)

elements = [
    Paragraph("METROPOLITAN UNIVERSITY HOSPITAL & HEALTH SYSTEM", title_style),
    Spacer(1, 10),
    Paragraph("DEPARTMENT OF PATHOLOGY & LABORATORY MEDICINE", styles['Normal']),
    Spacer(1, 10),
]

# Patient demographic table
patient_data = [
    ["Patient Name: Arthur Pendelton", "MRN: PAT-2001-9872", "DOB: 1972-04-12 (54Y / M)"],
    ["Accession #: ACC-2026-8819", "Ordering MD: Dr. Robert Vance, MD", "Report Date: 2026-03-14 09:30"]
]
t = Table(patient_data, colWidths=[200, 180, 160])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f1f5f9')),
    ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
    ('FONTSIZE', (0,0), (-1,-1), 8.5),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
]))
elements.append(t)
elements.append(Spacer(1, 15))

# Clinical history paragraph containing test keyword
history_style = ParagraphStyle('Hist', parent=styles['Normal'], fontSize=9, leading=13)
elements.append(Paragraph("<b>CLINICAL INDICATION & HISTORY:</b> Patient with reported history of seasonal allergies and medication intolerance. Investigating recurrent symptoms.", history_style))
elements.append(Spacer(1, 12))

# Lab Results Table
lab_headers = [["ANALYTE / TEST NAME", "RESULT", "UNITS", "REFERENCE RANGE", "FLAG"]]
lab_rows = [
    ["White Blood Cell Count (WBC)", "8.4", "x10^3/uL", "4.5 - 11.0", "NORMAL"],
    ["Absolute Eosinophil Count", "0.68", "x10^3/uL", "0.00 - 0.45", "HIGH*"],
    ["Immunoglobulin E (Total IgE)", "342.0", "kU/L", "< 100.0", "ELEVATED*"],
    ["Penicillin Specific IgE", "0.02", "kU/L", "< 0.35 (Class 0)", "NEGATIVE"],
]
lt = Table(lab_headers + lab_rows, colWidths=[180, 80, 80, 120, 80])
lt.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0f2942')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
    ('FONTSIZE', (0,0), (-1,-1), 8.5),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
    ('ALIGN', (1,0), (-1,-1), 'CENTER'),
    ('TEXTCOLOR', (4,2), (4,2), colors.HexColor('#b91c1c')),
    ('TEXTCOLOR', (4,3), (4,3), colors.HexColor('#b91c1c')),
]))
elements.append(lt)

doc.build(elements)
pdf_data = buffer.getvalue()

# Verify text extraction with pypdf
reader = pypdf.PdfReader(io.BytesIO(pdf_data))
page_text = reader.pages[0].extract_text()
print("Extracted text snippet:")
print(page_text[:300])

# Test highlighter on this ReportLab PDF
annotated_bytes, count, locations = highlight_pdf_bytes(pdf_data, "allergies")
print(f"\nHighlight test for 'allergies': {count} occurrences found")
for loc in locations:
    print(f"  Page {loc['page']}: '{loc['matched_text']}' at coordinates [{loc['x1']}, {loc['y1']}, {loc['x2']}, {loc['y2']}]")

assert "allergies" in page_text.lower(), "Expected 'allergies' in extracted text"
assert count >= 1, f"Expected at least 1 highlight for 'allergies', got {count}"
print("\nSUCCESS: ReportLab PDF generated, extracted, and highlighted cleanly!")
