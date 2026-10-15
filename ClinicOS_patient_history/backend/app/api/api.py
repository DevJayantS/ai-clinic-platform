from fastapi import APIRouter
from backend.app.api.endpoints import patients, documents, system

api_router = APIRouter()
api_router.include_router(patients.router)
api_router.include_router(documents.router)
api_router.include_router(system.router)
