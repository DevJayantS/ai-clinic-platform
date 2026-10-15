export interface Patient {
  id: number;
  patient_code: string;
  display_name: string;
  created_at: string;
  document_count: number;
}

export interface PatientCreate {
  patient_code?: string;
  display_name: string;
}

export interface DocumentItem {
  id: number;
  patient_id: number;
  original_filename: string;
  file_type: 'pdf' | 'docx' | 'txt' | string;
  file_size: number;
  file_hash: string;
  page_count: number;
  processing_status: 'pending' | 'processing' | 'completed' | 'partially_completed' | 'failed';
  processing_error?: string | null;
  ocr_applied: boolean;
  uploaded_at: string;
  processed_at?: string | null;
  segment_count: number;
}

export interface DocumentSegment {
  id: number;
  page_number: number;
  segment_type: string;
  content: string;
  extraction_method: string;
}

export interface SearchOccurrence {
  occurrence_id: string;
  document_id: number;
  document_filename: string;
  file_type: string;
  page_number: number;
  segment_type: string;
  matched_text: string;
  context_excerpt: string;
  start_offset: number;
  end_offset: number;
  extraction_method: string;
}

export interface SearchResponse {
  patient_id: number;
  patient_code: string;
  patient_name: string;
  query: string;
  mode: 'exact' | 'flexible';
  total_matches: number;
  matching_documents_count: number;
  total_searched_documents: number;
  processing_documents_count: number;
  failed_documents_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: SearchOccurrence[];
  warnings: string[];
}

export interface SystemStatus {
  ocr_available: boolean;
  ocr_engine: string;
  max_upload_size_bytes: number;
  allowed_extensions: string[];
  total_patients: number;
  total_documents: number;
}
