import type {
  Patient,
  PatientCreate,
  DocumentItem,
  DocumentSegment,
  SearchResponse,
  SystemStatus,
} from '../types';

const API_BASE = '/api';

export async function fetchPatients(): Promise<Patient[]> {
  const res = await fetch(`${API_BASE}/patients`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch patients' }));
    throw new Error(err.detail || 'Failed to fetch patients');
  }
  return res.json();
}

export async function createPatient(payload: PatientCreate): Promise<Patient> {
  const res = await fetch(`${API_BASE}/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create patient' }));
    throw new Error(err.detail || 'Failed to create patient');
  }
  return res.json();
}

export async function fetchPatient(patientId: number): Promise<Patient> {
  const res = await fetch(`${API_BASE}/patients/${patientId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch patient' }));
    throw new Error(err.detail || 'Failed to fetch patient');
  }
  return res.json();
}

export async function deletePatient(patientId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/patients/${patientId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to delete patient' }));
    throw new Error(err.detail || 'Failed to delete patient');
  }
}

export async function fetchPatientDocuments(patientId: number): Promise<DocumentItem[]> {
  const res = await fetch(`${API_BASE}/patients/${patientId}/documents`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch documents' }));
    throw new Error(err.detail || 'Failed to fetch documents');
  }
  return res.json();
}

export async function uploadDocuments(
  patientId: number,
  files: File[]
): Promise<DocumentItem[]> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const res = await fetch(`${API_BASE}/patients/${patientId}/documents`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to upload documents' }));
    throw new Error(err.detail || 'Failed to upload documents');
  }
  return res.json();
}

export async function deleteDocument(documentId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to delete document' }));
    throw new Error(err.detail || 'Failed to delete document');
  }
}

export async function reprocessDocument(documentId: number): Promise<DocumentItem> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/reprocess`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to reprocess document' }));
    throw new Error(err.detail || 'Failed to reprocess document');
  }
  return res.json();
}

export function getDocumentContentUrl(
  documentId: number,
  highlightTerm?: string,
  download: boolean = false
): string {
  const params = new URLSearchParams();
  if (highlightTerm && highlightTerm.trim()) {
    params.append('highlight', highlightTerm.trim());
  }
  if (download) {
    params.append('download', 'true');
  }
  const queryStr = params.toString();
  return queryStr
    ? `${API_BASE}/documents/${documentId}/content?${queryStr}`
    : `${API_BASE}/documents/${documentId}/content`;
}

export interface DocumentSearchLocation {
  page: number;
  matched_text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  line_text: string;
}

export interface DocumentSearchLocationsResponse {
  document_id: number;
  query: string;
  total_locations: number;
  pages_with_matches: number[];
  locations: DocumentSearchLocation[];
}

export async function fetchDocumentSearchLocations(
  documentId: number,
  query: string
): Promise<DocumentSearchLocationsResponse> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/search-locations?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    return {
      document_id: documentId,
      query,
      total_locations: 0,
      pages_with_matches: [],
      locations: [],
    };
  }
  return res.json();
}

export async function getDocumentSegments(documentId: number): Promise<DocumentSegment[]> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/segments`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch document segments' }));
    throw new Error(err.detail || 'Failed to fetch document segments');
  }
  return res.json();
}

export async function searchPatientDocumentsApi(
  patientId: number,
  query: string,
  mode: 'exact' | 'flexible' = 'exact',
  page: number = 1,
  pageSize: number = 20
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    mode: mode,
    page: page.toString(),
    page_size: pageSize.toString(),
  });
  const res = await fetch(`${API_BASE}/patients/${patientId}/search?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Search request failed' }));
    throw new Error(err.detail || 'Search request failed');
  }
  return res.json();
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch(`${API_BASE}/system/status`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to fetch system status' }));
    throw new Error(err.detail || 'Failed to fetch system status');
  }
  return res.json();
}

export async function seedDemoDataApi(): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/system/seed-demo`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to seed demonstration data' }));
    throw new Error(err.detail || 'Failed to seed demonstration data');
  }
  return res.json();
}
