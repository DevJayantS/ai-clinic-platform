import os
import sys
sys.path.insert(0, os.path.abspath('.'))

from backend.app.services.pdf_highlighter import highlight_pdf_bytes

with open('sample_medical_reports/PAT-2001/PAT2001_Allergy_Panel_Report.pdf', 'rb') as f:
    pdf_bytes = f.read()

annotated_bytes, count, locations = highlight_pdf_bytes(pdf_bytes, 'allergy')
print(f'Total highlights injected: {count}')
print(f'Locations found: {len(locations)}')
for loc in locations:
    print(f"  Page {loc['page']}: '{loc['matched_text']}' at [{loc['x1']}, {loc['y1']}, {loc['x2']}, {loc['y2']}]")

assert count == 8, f"Expected 8 highlights, got {count}"
assert len(annotated_bytes) > len(pdf_bytes), "Annotated PDF should contain extra annotations"
print("SUCCESS: PDF highlighter service passed validation!")
