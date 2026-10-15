import io
import os
import sys
sys.path.insert(0, os.path.abspath('.'))

import pypdf
from backend.app.services.pdf_highlighter import highlight_pdf_bytes

test_file = 'backend/storage/documents/pat_5_80e0f5893adf_Patient_History_Search_Demo.pdf'
with open(test_file, 'rb') as f:
    orig_bytes = f.read()

annotated_bytes, count, locations = highlight_pdf_bytes(orig_bytes, 'sneezing')

with open('scratch/user_doc_annotated.pdf', 'wb') as f:
    f.write(annotated_bytes)

reader = pypdf.PdfReader(io.BytesIO(annotated_bytes))
page = reader.pages[0]
print("PAGE KEYS:", page.keys())
print("CONTENTS TYPE:", type(page['/Contents']))
print("CONTENTS VALUE:", page['/Contents'])
if '/Resources' in page:
    print("RESOURCES KEYS:", page['/Resources'].keys())
    if '/Font' in page['/Resources']:
        print("FONTS:", page['/Resources']['/Font'])
