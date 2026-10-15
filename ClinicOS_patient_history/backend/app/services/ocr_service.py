import os
import shutil
import logging
from typing import Tuple, Optional

logger = logging.getLogger(__name__)

# Common Windows and Linux Tesseract executable locations
TESSERACT_COMMON_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    r"C:\Users\AppData\Local\Tesseract-OCR\tesseract.exe",
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
]

_tesseract_path: Optional[str] = None
_ocr_checked: bool = False

def get_tesseract_path() -> Optional[str]:
    global _tesseract_path, _ocr_checked
    if _ocr_checked:
        return _tesseract_path

    from backend.app.core.config import settings

    # 1. Explicitly configured TESSERACT_CMD
    if settings.TESSERACT_CMD and os.path.isfile(settings.TESSERACT_CMD):
        _tesseract_path = settings.TESSERACT_CMD
        _ocr_checked = True
        return _tesseract_path

    # 2. Check PATH
    which_path = shutil.which("tesseract")
    if which_path:
        _tesseract_path = which_path
        _ocr_checked = True
        return _tesseract_path

    # 3. Check known install locations
    for path in TESSERACT_COMMON_PATHS:
        if os.path.isfile(path):
            _tesseract_path = path
            _ocr_checked = True
            return _tesseract_path

    _ocr_checked = True
    _tesseract_path = None
    return None

def is_ocr_available() -> Tuple[bool, str]:
    path = get_tesseract_path()
    if path:
        return True, f"Tesseract OCR located at {path}"
    return False, "Tesseract OCR engine is not installed or not in system PATH."

def extract_text_from_image(image) -> str:
    """Extract text from a PIL Image using Tesseract OCR if available."""
    path = get_tesseract_path()
    if not path:
        raise RuntimeError("Tesseract OCR is not available on this system.")
    
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = path
    return pytesseract.image_to_string(image)
