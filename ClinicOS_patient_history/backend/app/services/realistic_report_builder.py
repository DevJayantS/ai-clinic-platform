"""
Realistic Clinical Medical Report PDF Builder using ReportLab.
Produces authentic-looking hospital laboratory reports, diagnostic radiology studies,
and inpatient discharge documentation with professional typography, demographic grids,
standard test tables, clinical sections, and electronic signature blocks.
"""

import io
from typing import List, Dict, Any, Optional
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak, KeepTogether
)
from reportlab.pdfgen import canvas

# Professional Medical Palette
PRIMARY_COLOR = colors.HexColor('#0f2942')    # Deep Navy
SECONDARY_COLOR = colors.HexColor('#0284c7')  # Medical Teal / Blue
SLATE_BG = colors.HexColor('#f8fafc')         # Very Light Slate
BORDER_COLOR = colors.HexColor('#cbd5e1')     # Soft Slate Border
TEXT_COLOR = colors.HexColor('#1e293b')       # Dark Slate Text
MUTED_TEXT = colors.HexColor('#64748b')       # Muted Gray
HIGH_FLAG_COLOR = colors.HexColor('#b91c1c')  # Bold Crimson for abnormal flags
WARN_BG = colors.HexColor('#fef3c7')          # Amber background


class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas for dynamic 'Page X of Y' and institutional running footer."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages: int):
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor('#64748b'))

        # Header rule and confidential notice
        self.setStrokeColor(colors.HexColor('#e2e8f0'))
        self.setLineWidth(0.5)

        # Footer divider and content
        self.line(36, 42, 576, 42)
        footer_text = (
            "CONFIDENTIAL MEDICAL RECORD — ST. JUDE METROPOLITAN HOSPITAL HEALTH SYSTEM — "
            "CLIA # 39D0654321 — CAP ACCREDITED"
        )
        self.drawString(36, 30, footer_text)
        page_str = f"Page {self._pageNumber} of {total_pages}"
        self.drawRightString(576, 30, page_str)

        # Watermark/disclaimer bar
        self.setFont("Helvetica-Bold", 7.0)
        self.setFillColor(colors.HexColor('#94a3b8'))
        self.drawCentredString(306, 18, "*** SYNTHETIC CLINICAL TEST DATA — NOT FOR CLINICAL USE — SYSTEM VERIFICATION ONLY ***")

        self.restoreState()


def get_medical_styles():
    styles = getSampleStyleSheet()

    custom_styles = {
        'HospName': ParagraphStyle(
            'HospName',
            fontName='Helvetica-Bold',
            fontSize=13,
            leading=16,
            textColor=PRIMARY_COLOR
        ),
        'HospSub': ParagraphStyle(
            'HospSub',
            fontName='Helvetica',
            fontSize=8,
            leading=11,
            textColor=MUTED_TEXT
        ),
        'ReportTitle': ParagraphStyle(
            'ReportTitle',
            fontName='Helvetica-Bold',
            fontSize=12,
            leading=15,
            textColor=PRIMARY_COLOR,
            spaceAfter=4
        ),
        'SectionHeading': ParagraphStyle(
            'SectionHeading',
            fontName='Helvetica-Bold',
            fontSize=9.5,
            leading=13,
            textColor=SECONDARY_COLOR,
            spaceBefore=8,
            spaceAfter=4
        ),
        'ClinicalBody': ParagraphStyle(
            'ClinicalBody',
            fontName='Helvetica',
            fontSize=8.5,
            leading=12.5,
            textColor=TEXT_COLOR
        ),
        'ClinicalBodyBold': ParagraphStyle(
            'ClinicalBodyBold',
            fontName='Helvetica-Bold',
            fontSize=8.5,
            leading=12.5,
            textColor=TEXT_COLOR
        ),
        'TableCell': ParagraphStyle(
            'TableCell',
            fontName='Helvetica',
            fontSize=8,
            leading=10.5,
            textColor=TEXT_COLOR
        ),
        'TableCellBold': ParagraphStyle(
            'TableCellBold',
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=10.5,
            textColor=TEXT_COLOR
        ),
        'TableCellFlag': ParagraphStyle(
            'TableCellFlag',
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=10.5,
            textColor=HIGH_FLAG_COLOR,
            alignment=1
        ),
        'Disclaimer': ParagraphStyle(
            'Disclaimer',
            fontName='Helvetica-Oblique',
            fontSize=7.5,
            leading=10,
            textColor=MUTED_TEXT
        )
    }

    for k, v in custom_styles.items():
        styles.add(v)

    return styles


def create_header_elements(
    facility_name: str,
    department_name: str,
    report_title: str,
    clia_info: str = "CLIA # 39D0654321 • CAP # 7182940 • JCAHO ACCREDITED",
    styles = None
) -> List[Any]:
    if styles is None:
        styles = get_medical_styles()

    header_table_data = [
        [
            Paragraph(f"<b>{facility_name.upper()}</b>", styles['HospName']),
            Paragraph(f"<b>{department_name.upper()}</b><br/>{clia_info}", styles['HospSub'])
        ]
    ]

    t_header = Table(header_table_data, colWidths=[310, 230])
    t_header.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))

    elements = [
        t_header,
        Spacer(1, 4),
        HRFlowable(width="100%", thickness=1.5, color=PRIMARY_COLOR, spaceBefore=2, spaceAfter=8),
        Paragraph(report_title, styles['ReportTitle']),
        Spacer(1, 4)
    ]
    return elements


def create_demographics_box(
    patient_name: str,
    patient_id: str,
    dob: str,
    age_sex: str,
    ordering_md: str,
    accession_no: str,
    report_date: str,
    specimen_info: str = "Blood (Venous EDTA / SST)",
    styles = None
) -> Table:
    if styles is None:
        styles = get_medical_styles()

    demo_data = [
        [
            Paragraph(f"<b>Patient Name:</b> {patient_name}", styles['TableCell']),
            Paragraph(f"<b>Patient ID (MRN):</b> {patient_id}", styles['TableCell']),
            Paragraph(f"<b>DOB / Age / Sex:</b> {dob} ({age_sex})", styles['TableCell'])
        ],
        [
            Paragraph(f"<b>Accession #:</b> {accession_no}", styles['TableCell']),
            Paragraph(f"<b>Ordering Provider:</b> {ordering_md}", styles['TableCell']),
            Paragraph(f"<b>Report Date/Time:</b> {report_date}", styles['TableCell'])
        ],
        [
            Paragraph(f"<b>Specimen / Exam:</b> {specimen_info}", styles['TableCell']),
            Paragraph("<b>Status:</b> FINAL SIGNED REPORT", styles['TableCellBold']),
            Paragraph("<b>Facility Code:</b> SJMH-MAIN-CAMPUS", styles['TableCell'])
        ]
    ]

    t_demo = Table(demo_data, colWidths=[185, 185, 170])
    t_demo.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('BOX', (0,0), (-1,-1), 0.75, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    return t_demo


def create_lab_results_table(
    headers: List[str],
    rows: List[List[str]],
    col_widths: List[float] = [170, 75, 75, 130, 90],
    styles = None
) -> Table:
    if styles is None:
        styles = get_medical_styles()

    formatted_data = []

    # Header Row
    header_cells = [
        Paragraph(f"<b>{h}</b>", ParagraphStyle('TH', parent=styles['TableCellBold'], textColor=colors.white, alignment=1 if i in [1, 2, 4] else 0))
        for i, h in enumerate(headers)
    ]
    formatted_data.append(header_cells)

    # Data Rows
    for row in rows:
        row_cells = []
        is_high = len(row) > 4 and ('HIGH' in row[4] or 'ELEVATED' in row[4] or 'POSITIVE' in row[4] or '*' in row[4])
        for c_idx, cell_text in enumerate(row):
            if c_idx == 4 and is_high:
                row_cells.append(Paragraph(cell_text, styles['TableCellFlag']))
            elif c_idx == 0:
                row_cells.append(Paragraph(cell_text, styles['TableCellBold']))
            elif c_idx in [1, 2]:
                row_cells.append(Paragraph(cell_text, ParagraphStyle('TC_C', parent=styles['TableCell'], alignment=1)))
            else:
                row_cells.append(Paragraph(cell_text, styles['TableCell']))
        formatted_data.append(row_cells)

    t_lab = Table(formatted_data, colWidths=col_widths)
    t_lab.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY_COLOR),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
        ('TOPPADDING', (0,0), (-1,-1), 3.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    return t_lab


def create_signature_block(
    doctor_name: str,
    credentials: str,
    npi: str,
    timestamp: str,
    styles = None
) -> KeepTogether:
    if styles is None:
        styles = get_medical_styles()

    sig_data = [
        [
            Paragraph(
                f"<b>Electronically Verified & Signed By:</b><br/>"
                f"<font size='9'><b>{doctor_name}, {credentials}</b></font><br/>"
                f"NPI: {npi} • State License: MD-6691823<br/>"
                f"Verification Timestamp: {timestamp} (EST)",
                styles['TableCell']
            ),
            Paragraph(
                "<b>Authentication Verification:</b><br/>"
                "✓ Cryptographic SHA-256 Validated<br/>"
                "✓ Medical Director Authorized<br/>"
                "✓ Integrated Health OS Secure Node",
                styles['TableCell']
            )
        ]
    ]

    t_sig = Table(sig_data, colWidths=[330, 210])
    t_sig.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f1f5f9')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))

    return KeepTogether([
        Spacer(1, 10),
        t_sig,
        Spacer(1, 6)
    ])


def build_pdf_document(
    output_path: str,
    elements: List[Any]
):
    """Build PDF document using custom NumberedCanvas."""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=48
    )
    doc.build(elements, canvasmaker=NumberedCanvas)
