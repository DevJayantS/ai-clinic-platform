import os
import io
import logging
from dataclasses import dataclass
from typing import List, Optional
from backend.app.services.ocr_service import is_ocr_available, extract_text_from_image

logger = logging.getLogger(__name__)

@dataclass
class ExtractedSegment:
    page_number: int  # 1-indexed page or paragraph/section number
    segment_type: str  # 'page', 'paragraph', 'section'
    content: str
    extraction_method: str  # 'direct', 'ocr', 'fallback'

class ExtractionError(Exception):
    """Custom exception for document parsing failures."""
    pass

def extract_from_txt(file_path: str) -> List[ExtractedSegment]:
    """Extract text from a plain text file, splitting by logical paragraphs."""
    try:
        content = None
        for encoding in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
            try:
                with open(file_path, "r", encoding=encoding) as f:
                    content = f.read()
                break
            except (UnicodeDecodeError, UnicodeError):
                continue

        if content is None:
            raise ExtractionError("Unable to decode text file with supported encodings.")

        if not content.strip():
            return []

        # Split by double newlines into meaningful paragraphs
        raw_paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        if not raw_paragraphs:
            raw_paragraphs = [content.strip()]

        segments: List[ExtractedSegment] = []
        for idx, para in enumerate(raw_paragraphs, start=1):
            segments.append(
                ExtractedSegment(
                    page_number=idx,
                    segment_type="paragraph",
                    content=para,
                    extraction_method="direct"
                )
            )
        return segments

    except Exception as e:
        if isinstance(e, ExtractionError):
            raise
        raise ExtractionError(f"Failed to read TXT file: {str(e)}") from e


def extract_from_docx(file_path: str) -> List[ExtractedSegment]:
    """Extract text from a Word DOCX file, preserving paragraph locations."""
    has_docx = False
    try:
        import docx
        has_docx = True
    except ImportError:
        has_docx = False

    if has_docx:
        try:
            doc = docx.Document(file_path)
            segments: List[ExtractedSegment] = []
            para_num = 1

            for p in doc.paragraphs:
                text = p.text.strip()
                if text:
                    segments.append(
                        ExtractedSegment(
                            page_number=para_num,
                            segment_type="paragraph",
                            content=text,
                            extraction_method="direct"
                        )
                    )
                    para_num += 1

            for table in doc.tables:
                table_lines = []
                for row in table.rows:
                    row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                    if row_text:
                        table_lines.append(row_text)
                if table_lines:
                    segments.append(
                        ExtractedSegment(
                            page_number=para_num,
                            segment_type="table",
                            content="\n".join(table_lines),
                            extraction_method="direct"
                        )
                    )
                    para_num += 1

            return segments
        except Exception as e:
            logger.warning(f"python-docx failed, attempting standard zipfile XML parser: {e}")

    # Robust fallback: standard library zipfile + xml.etree.ElementTree (zero external dependencies)
    try:
        import zipfile
        import xml.etree.ElementTree as ET

        if not zipfile.is_zipfile(file_path):
            raise ExtractionError("The file is not a valid DOCX package.")

        segments: List[ExtractedSegment] = []
        para_num = 1

        with zipfile.ZipFile(file_path, "r") as zf:
            if "word/document.xml" not in zf.namelist():
                raise ExtractionError("word/document.xml missing from DOCX package.")
            xml_bytes = zf.read("word/document.xml")

        root = ET.fromstring(xml_bytes)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

        # Extract all paragraphs
        for p in root.findall(".//w:p", ns):
            texts = [t.text for t in p.findall(".//w:t", ns) if t.text]
            p_text = "".join(texts).strip()
            if p_text:
                segments.append(
                    ExtractedSegment(
                        page_number=para_num,
                        segment_type="paragraph",
                        content=p_text,
                        extraction_method="direct"
                    )
                )
                para_num += 1

        return segments
    except Exception as e:
        if isinstance(e, ExtractionError):
            raise
        raise ExtractionError(f"Failed to parse DOCX file: {str(e)}") from e


def extract_from_pdf(file_path: str) -> List[ExtractedSegment]:
    """Extract text from a PDF file page by page, applying OCR if page text is empty/scanned."""
    segments: List[ExtractedSegment] = []
    ocr_ready, ocr_engine_info = is_ocr_available()

    # Try PyMuPDF (fitz) first if installed, fallback to pypdf
    has_pymupdf = False
    try:
        import fitz  # PyMuPDF
        has_pymupdf = True
    except ImportError:
        has_pymupdf = False

    if has_pymupdf:
        try:
            doc = fitz.open(file_path)
            if doc.is_encrypted:
                raise ExtractionError("The PDF file is password protected or encrypted.")

            for page_index in range(len(doc)):
                page_num = page_index + 1
                page = doc[page_index]
                text = page.get_text("text").strip()

                if len(text) >= 15:
                    segments.append(
                        ExtractedSegment(
                            page_number=page_num,
                            segment_type="page",
                            content=text,
                            extraction_method="direct"
                        )
                    )
                else:
                    # Page seems scanned or empty; attempt OCR if available
                    if ocr_ready:
                        try:
                            from PIL import Image
                            # Render page to pixmap
                            pix = page.get_pixmap(dpi=200)
                            img_data = pix.tobytes("png")
                            pil_img = Image.open(io.BytesIO(img_data))
                            ocr_text = extract_text_from_image(pil_img).strip()

                            if ocr_text:
                                segments.append(
                                    ExtractedSegment(
                                        page_number=page_num,
                                        segment_type="page",
                                        content=ocr_text,
                                        extraction_method="ocr"
                                    )
                                )
                                continue
                        except Exception as ocr_err:
                            logger.warning(f"OCR failed for PDF page {page_num}: {ocr_err}")

                    # Fallback to whatever direct text was found, even if sparse
                    if text:
                        segments.append(
                            ExtractedSegment(
                                page_number=page_num,
                                segment_type="page",
                                content=text,
                                extraction_method="direct"
                            )
                        )

            doc.close()
            return segments
        except Exception as e:
            if isinstance(e, ExtractionError):
                raise
            logger.warning(f"PyMuPDF failed on {file_path}, trying pypdf: {e}")

    # Fallback to pypdf
    try:
        from pypdf import PdfReader
        reader = PdfReader(file_path)

        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise ExtractionError("The PDF file is password-protected or encrypted.")

        for page_index, page in enumerate(reader.pages):
            page_num = page_index + 1
            try:
                page_text = (page.extract_text() or "").strip()
            except Exception as extract_err:
                page_text = ""
                logger.warning(f"pypdf extraction error on page {page_num}: {extract_err}")

            if len(page_text) >= 15:
                segments.append(
                    ExtractedSegment(
                        page_number=page_num,
                        segment_type="page",
                        content=page_text,
                        extraction_method="direct"
                    )
                )
            else:
                # Scanned page check: if page has images and OCR is ready
                ocr_extracted = False
                if ocr_ready and hasattr(page, "images") and len(page.images) > 0:
                    try:
                        from PIL import Image
                        ocr_parts = []
                        for img in page.images:
                            pil_img = Image.open(io.BytesIO(img.data))
                            t = extract_text_from_image(pil_img).strip()
                            if t:
                                ocr_parts.append(t)
                        if ocr_parts:
                            combined_ocr = "\n".join(ocr_parts)
                            segments.append(
                                ExtractedSegment(
                                    page_number=page_num,
                                    segment_type="page",
                                    content=combined_ocr,
                                    extraction_method="ocr"
                                )
                            )
                            ocr_extracted = True
                    except Exception as ocr_err:
                        logger.warning(f"pypdf OCR extraction failed for page {page_num}: {ocr_err}")

                if not ocr_extracted and page_text:
                    segments.append(
                        ExtractedSegment(
                            page_number=page_num,
                            segment_type="page",
                            content=page_text,
                            extraction_method="direct"
                        )
                    )

        return segments
    except Exception as e:
        if isinstance(e, ExtractionError):
            raise
        raise ExtractionError(f"Failed to parse PDF file: {str(e)}") from e


def extract_document_segments(file_path: str, file_type: str) -> List[ExtractedSegment]:
    """Unified dispatcher for document text extraction based on file type."""
    if not os.path.exists(file_path):
        raise ExtractionError("File does not exist on disk.")

    file_type = file_type.lower().replace(".", "")
    if file_type == "pdf":
        return extract_from_pdf(file_path)
    elif file_type == "docx":
        return extract_from_docx(file_path)
    elif file_type in ("txt", "text"):
        return extract_from_txt(file_path)
    else:
        raise ExtractionError(f"Unsupported file format: {file_type}")
