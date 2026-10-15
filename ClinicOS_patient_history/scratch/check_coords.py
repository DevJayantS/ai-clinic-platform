import io
import os
import sys
sys.path.insert(0, os.path.abspath('.'))

from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
import pypdf

buf = io.BytesIO()
doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=36, topMargin=36)
styles = getSampleStyleSheet()
doc.build([Paragraph("Patient with allergies.", styles['Normal'])])

reader = pypdf.PdfReader(buf)
page = reader.pages[0]
def visitor(text, cm, tm, font_dict, font_size):
    if 'allergies' in text.lower():
        print("VISITOR:")
        print("  text:", repr(text))
        print("  cm:", cm)
        print("  tm:", tm)
        print("  font_size:", font_size)

page.extract_text(visitor_text=visitor)
