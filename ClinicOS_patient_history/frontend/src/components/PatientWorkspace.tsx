import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Search,
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  Eye,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  FileUp,
} from 'lucide-react';
import type { Patient, DocumentItem, SearchResponse } from '../types';
import {
  fetchPatientDocuments,
  uploadDocuments,
  deleteDocument,
  reprocessDocument,
  searchPatientDocumentsApi,
  getDocumentContentUrl,
} from '../services/api';
import { SearchResults } from './SearchResults';
import { DocumentPreviewModal } from './DocumentPreviewModal';

interface PatientWorkspaceProps {
  patient: Patient;
  onBack: () => void;
}

export const PatientWorkspace: React.FC<PatientWorkspaceProps> = ({ patient, onBack }) => {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'exact' | 'flexible'>('exact');
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<{
    id: number;
    filename: string;
    fileType: string;
    targetPage: number;
    highlightTerm?: string;
    matchedText?: string;
  } | null>(null);

  // Tab state between Search Results & Document Manager
  const [activeTab, setActiveTab] = useState<'search' | 'documents'>('search');

  useEffect(() => {
    loadDocuments();
  }, [patient.id]);

  const loadDocuments = async () => {
    setLoadingDocs(true);
    try {
      const docs = await fetchPatientDocuments(patient.id);
      setDocuments(docs);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingDocs(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const fileList = Array.from(e.target.files);

    setUploading(true);
    setUploadError(null);
    try {
      await uploadDocuments(patient.id, fileList);
      await loadDocuments();
      // Reset input
      e.target.value = '';
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: number) => {
    try {
      await deleteDocument(docId);
      await loadDocuments();
      // If active search results came from this document, re-run search if active
      if (searchResult && searchQuery.trim()) {
        executeSearch(searchQuery, searchMode, currentPage);
      }
    } catch (err: any) {
      alert(`Failed to delete document: ${err.message}`);
    }
  };

  const handleReprocessDocument = async (docId: number) => {
    try {
      await reprocessDocument(docId);
      await loadDocuments();
      if (searchResult && searchQuery.trim()) {
        executeSearch(searchQuery, searchMode, currentPage);
      }
    } catch (err: any) {
      alert(`Failed to reprocess: ${err.message}`);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setCurrentPage(1);
    setActiveTab('search');
    executeSearch(searchQuery.trim(), searchMode, 1);
  };

  const executeSearch = async (
    query: string,
    mode: 'exact' | 'flexible',
    page: number
  ) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchPatientDocumentsApi(patient.id, query, mode, page, 100);
      setSearchResult(res);
      setCurrentPage(page);
    } catch (err: any) {
      setSearchError(err.message || 'Search execution failed.');
    } finally {
      setSearching(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (searchQuery.trim()) {
      executeSearch(searchQuery.trim(), searchMode, newPage);
    }
  };

  const handlePreview = (
    docId: number,
    filename: string,
    fileType: string,
    pageNumber: number,
    highlightTerm?: string,
    matchedText?: string
  ) => {
    setPreviewDoc({
      id: docId,
      filename,
      fileType,
      targetPage: pageNumber,
      highlightTerm: highlightTerm || (searchQuery.trim() ? searchQuery.trim() : undefined),
      matchedText,
    });
  };

  const completedDocsCount = documents.filter(
    (d) => d.processing_status === 'completed' || d.processing_status === 'partially_completed'
  ).length;

  return (
    <div>
      {/* Patient Header Card */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={onBack} title="Back to Patients">
              <ArrowLeft size={16} />
              <span>Patients</span>
            </button>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  style={{
                    background: 'var(--primary-light)',
                    color: 'var(--primary-dark)',
                    fontWeight: 700,
                    padding: '0.2rem 0.6rem',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                  }}
                >
                  {patient.patient_code}
                </span>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--secondary)' }}>
                  {patient.display_name}
                </h2>
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {documents.length} Associated Report{documents.length === 1 ? '' : 's'} ({completedDocsCount} Searchable) • Strict Patient-Level Data Isolation
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`btn btn-sm ${activeTab === 'search' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('search')}
            >
              <Search size={14} />
              <span>Search Records</span>
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'documents' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('documents')}
            >
              <FileText size={14} />
              <span>Documents ({documents.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search Bar Panel (Always visible at the top) */}
      <div className="search-box-card">
        <form onSubmit={handleSearchSubmit}>
          <div className="search-input-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="Search across all patient reports (e.g. allergies, blood pressure, infection, medication...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={searching || !searchQuery.trim()}
              style={{ minWidth: '120px' }}
            >
              <Search size={16} />
              <span>{searching ? 'Searching...' : 'Search'}</span>
            </button>

            {searchResult && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResult(null);
                  setSearchError(null);
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="search-options">
            <div className="mode-toggle">
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Matching Mode:</span>
              <label className="mode-label">
                <input
                  type="radio"
                  name="searchMode"
                  value="exact"
                  checked={searchMode === 'exact'}
                  onChange={() => setSearchMode('exact')}
                />
                <span>Exact Word / Phrase (Case-Insensitive)</span>
              </label>

              <label className="mode-label">
                <input
                  type="radio"
                  name="searchMode"
                  value="flexible"
                  checked={searchMode === 'flexible'}
                  onChange={() => setSearchMode('flexible')}
                />
                <span>Flexible (Singular & Plural Variants)</span>
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#0369a1' }}>
              <ShieldCheck size={15} />
              <span>Scope: Strictly scoped to {patient.patient_code}</span>
            </div>
          </div>
        </form>
      </div>

      {/* Tab 1: Search Results View */}
      {activeTab === 'search' && (
        <div>
          {searchError && <div className="alert alert-danger">{searchError}</div>}

          {/* Quick example search chips if no search performed yet */}
          {!searchResult && !searching && (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.75rem', color: 'var(--secondary)' }}>
                Ready to search {completedDocsCount} processed medical document(s) for {patient.patient_code}
              </p>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                Try searching for any clinical term or phrase present in the uploaded reports:
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {['allergies', 'blood pressure', 'infection', 'medication', 'diabetes', 'penicillin'].map((term) => (
                  <button
                    key={term}
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearchQuery(term);
                      executeSearch(term, searchMode, 1);
                    }}
                  >
                    "{term}"
                  </button>
                ))}
              </div>
            </div>
          )}

          <SearchResults
            searchResult={searchResult}
            loading={searching}
            onPageChange={handlePageChange}
            onPreviewDocument={handlePreview}
            onOpenDirectFile={(docId) => window.open(getDocumentContentUrl(docId), '_blank')}
          />
        </div>
      )}

      {/* Tab 2: Document Management View */}
      {activeTab === 'documents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Upload Dropzone Card */}
          <div className="card">
            <div className="card-header">
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileUp size={18} color="#0284c7" />
                <span>Upload Medical Reports for {patient.patient_code}</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Supported: PDF, DOCX, TXT (Max 25 MB)
              </span>
            </div>

            <div className="card-body">
              {uploadError && (
                <div className="alert alert-danger">
                  <AlertCircle size={16} />
                  <span>{uploadError}</span>
                </div>
              )}

              <label className="dropzone" style={{ display: 'block' }}>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                <Upload className="dropzone-icon" />
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--secondary)' }}>
                  {uploading ? 'Processing uploaded files...' : 'Click to select or drop medical reports here'}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Multiple files supported. Files are immediately validated, parsed, and indexed for search.
                </div>
              </label>
            </div>
          </div>

          {/* Document List Table */}
          <div className="card">
            <div className="card-header">
              <div style={{ fontWeight: 600 }}>Associated Reports ({documents.length})</div>
              <button className="btn btn-secondary btn-sm" onClick={loadDocuments} title="Refresh documents list">
                <RefreshCw size={13} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="table-container">
              {loadingDocs ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading documents...
                </div>
              ) : documents.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No reports uploaded for this patient yet. Use the upload box above to add PDF, DOCX, or TXT records.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Document Name</th>
                      <th>Type</th>
                      <th>Size</th>
                      <th>Pages / Segments</th>
                      <th>Status</th>
                      <th>Uploaded</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                            <FileText size={16} color="#0284c7" />
                            <span>{doc.original_filename}</span>
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-page" style={{ textTransform: 'uppercase' }}>
                            {doc.file_type}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                          {(doc.file_size / 1024).toFixed(1)} KB
                        </td>
                        <td>
                          {doc.page_count > 0 ? (
                            <span>{doc.page_count} {doc.file_type === 'pdf' ? 'Pages' : 'Segments'}</span>
                          ) : (
                            <span style={{ color: 'var(--text-subtle)' }}>-</span>
                          )}
                        </td>
                        <td>
                          {doc.processing_status === 'completed' && (
                            <span className="badge-status badge-completed">
                              <CheckCircle2 size={12} />
                              <span>Indexed</span>
                              {doc.ocr_applied && <span style={{ fontSize: '0.65rem' }}>(OCR)</span>}
                            </span>
                          )}
                          {doc.processing_status === 'processing' && (
                            <span className="badge-status badge-processing">
                              <Clock size={12} />
                              <span>Processing...</span>
                            </span>
                          )}
                          {doc.processing_status === 'failed' && (
                            <span
                              className="badge-status badge-failed"
                              title={doc.processing_error || 'Processing failed'}
                            >
                              <AlertCircle size={12} />
                              <span>Failed</span>
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                          {new Date(doc.uploaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handlePreview(doc.id, doc.original_filename, doc.file_type, 1)}
                              title="View Document"
                            >
                              <Eye size={13} />
                            </button>

                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleReprocessDocument(doc.id)}
                              title="Reprocess & Re-index document"
                            >
                              <RefreshCw size={13} />
                            </button>

                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                if (window.confirm(`Delete ${doc.original_filename}?`)) {
                                  handleDeleteDocument(doc.id);
                                }
                              }}
                              title="Delete document"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        isOpen={Boolean(previewDoc)}
        documentId={previewDoc?.id || null}
        filename={previewDoc?.filename || ''}
        fileType={previewDoc?.fileType || ''}
        targetPage={previewDoc?.targetPage || 1}
        highlightTerm={previewDoc?.highlightTerm}
        matchedText={previewDoc?.matchedText}
        onClose={() => setPreviewDoc(null)}
      />
    </div>
  );
};
