import os
from typing import List

def escape_pdf_text(text: str) -> str:
    """Escape parentheses and backslashes for PDF text streams."""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def create_pdf_bytes(pages: List[List[str]]) -> bytes:
    """
    Generate a valid, fully standard multi-page PDF 1.4 file in pure Python.
    No external C-extensions or GUI toolkits required.
    Compatible with PyMuPDF, pypdf, Adobe Acrobat, and modern web browsers.
    """
    objects = []
    
    # Object 1: Catalog
    # Object 2: Pages root
    # For each page:
    #   Object: Page
    #   Object: Page Content Stream
    # Object: Font
    
    num_pages = len(pages)
    # 1: Catalog
    # 2: Pages
    # 3: Font
    font_obj_num = 3
    
    page_obj_nums = []
    curr_obj = 4
    for i in range(num_pages):
        page_obj_num = curr_obj
        curr_obj += 1
        content_obj_num = curr_obj
        curr_obj += 1
        page_obj_nums.append((page_obj_num, content_obj_num))
        
    out = io_buffer = bytearray()
    offsets = {}

    def write_obj(num: int, content: bytes):
        offsets[num] = len(out)
        out.extend(f"{num} 0 obj\n".encode("latin1"))
        out.extend(content)
        out.extend(b"\nendobj\n")

    # Header
    out.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    # 1. Catalog
    write_obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")

    # 2. Pages Root
    kids_str = " ".join(f"{p[0]} 0 R" for p in page_obj_nums)
    pages_root = f"<< /Type /Pages /Kids [{kids_str}] /Count {num_pages} >>".encode("latin1")
    write_obj(2, pages_root)

    # 3. Standard Font (Helvetica)
    font_content = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    write_obj(font_obj_num, font_content)

    # Pages and contents
    for idx, (page_num, content_num) in enumerate(page_obj_nums):
        page_lines = pages[idx]
        
        # Build stream
        stream_lines = [b"BT", b"/F1 12 Tf"]
        y = 750
        stream_lines.append(f"50 {y} Td".encode("latin1"))
        
        for line in page_lines:
            safe_line = escape_pdf_text(line)
            stream_lines.append(f"({safe_line}) Tj".encode("latin1"))
            stream_lines.append(b"0 -18 Td")
            y -= 18

        stream_lines.append(b"ET")
        stream_data = b"\n".join(stream_lines)
        
        # Write Content Object
        stream_obj_content = (
            f"<< /Length {len(stream_data)} >>\nstream\n".encode("latin1")
            + stream_data
            + b"\nendstream"
        )
        write_obj(content_num, stream_obj_content)

        # Write Page Object
        page_content = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_obj_num} 0 R >> >> "
            f"/Contents {content_num} 0 R >>".encode("latin1")
        )
        write_obj(page_num, page_content)

    # Cross-reference table
    xref_offset = len(out)
    total_objects = curr_obj
    out.extend(f"xref\n0 {total_objects}\n".encode("latin1"))
    out.extend(b"0000000000 65535 f \n")
    for i in range(1, total_objects):
        offset = offsets.get(i, 0)
        out.extend(f"{offset:010d} 00000 n \n".encode("latin1"))

    # Trailer
    trailer = (
        f"trailer\n<< /Size {total_objects} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode("latin1")
    out.extend(trailer)

    return bytes(out)


def write_sample_pdf(file_path: str, pages: List[List[str]]):
    """Write synthetic PDF to disk."""
    data = create_pdf_bytes(pages)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(data)


def write_sample_docx(file_path: str, paragraphs: List[str]):
    """Write synthetic DOCX to disk."""
    import docx
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    doc = docx.Document()
    for para in paragraphs:
        doc.add_paragraph(para)
    doc.save(file_path)


def write_sample_txt(file_path: str, paragraphs: List[str]):
    """Write synthetic TXT to disk."""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("\n\n".join(paragraphs))
