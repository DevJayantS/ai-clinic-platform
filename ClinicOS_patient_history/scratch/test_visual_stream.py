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

reader = pypdf.PdfReader('sample_medical_reports/PAT-2001/PAT2001_CBC_Blood_Test.pdf')
writer = pypdf.PdfWriter()
for page in reader.pages:
    writer.add_page(page)

target_page = writer.pages[0]

# Prepare ExtGState for transparency
if '/Resources' not in target_page:
    target_page[NameObject('/Resources')] = DictionaryObject()
resources = target_page['/Resources']
if '/ExtGState' not in resources:
    resources[NameObject('/ExtGState')] = DictionaryObject()

ext_gstate = resources['/ExtGState']
ext_gstate[NameObject('/GS_HL')] = DictionaryObject({
    NameObject('/Type'): NameObject('/ExtGState'),
    NameObject('/ca'): FloatObject(0.4), # fill alpha 40%
    NameObject('/BM'): NameObject('/Multiply') # blend mode multiply
})

# Draw yellow rectangle over coordinates: x=50, y=584, w=50, h=14
drawing_commands = (
    "q\n"
    "/GS_HL gs\n"
    "1.0 0.90 0.0 rg\n"
    "50.0 584.0 50.0 14.0 re\n"
    "f\n"
    "Q\n"
)

stream = DecodedStreamObject()
stream.set_data(drawing_commands.encode('latin1'))
stream_ref = writer._add_object(stream)

if '/Contents' not in target_page:
    target_page[NameObject('/Contents')] = stream_ref
elif isinstance(target_page['/Contents'], ArrayObject):
    target_page['/Contents'].append(stream_ref)
else:
    # Wrap existing single content stream into array
    existing_ref = target_page['/Contents']
    target_page[NameObject('/Contents')] = ArrayObject([existing_ref, stream_ref])

with open('scratch/test_visual_highlight.pdf', 'wb') as f:
    writer.write(f)

print('Successfully created visual highlight stream!')
