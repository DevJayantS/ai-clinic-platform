import os
from typing import List

class Settings:
    PROJECT_NAME: str = "Patient Medical Document Search System"
    API_V1_STR: str = "/api"
    
    # Base directory: ClinicOS/
    BASE_DIR: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    # Database
    DATABASE_URL: str = os.environ.get(
        "DATABASE_URL", 
        f"sqlite:///{os.path.join(BASE_DIR, 'storage', 'patient_search.db')}"
    )
    
    # Storage
    STORAGE_DIR: str = os.environ.get(
        "STORAGE_DIR",
        os.path.join(BASE_DIR, "storage", "documents")
    )
    
    # Max upload size: 25 MB default (configurable)
    MAX_UPLOAD_SIZE_BYTES: int = int(os.environ.get("MAX_UPLOAD_SIZE_BYTES", str(25 * 1024 * 1024)))
    
    # Allowed extensions
    ALLOWED_EXTENSIONS: List[str] = [".pdf", ".docx", ".txt"]
    
    # OCR Settings
    TESSERACT_CMD: str = os.environ.get("TESSERACT_CMD", "")
    ENABLE_OCR: bool = os.environ.get("ENABLE_OCR", "true").lower() in ("true", "1", "yes")
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

settings = Settings()

# Ensure storage directories exist
os.makedirs(settings.STORAGE_DIR, exist_ok=True)
os.makedirs(os.path.join(settings.BASE_DIR, "storage"), exist_ok=True)
