import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  FileText,
  Download,
  ExternalLink,
  Layers,
  Eye,
  Highlighter,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import type { DocumentSegment } from '../types';
import {
  getDocumentContentUrl,
  getDocumentSegments,
  fetchDocumentSearchLocations,
  type DocumentSearchLocation,
} from '../services/api';

interface DocumentPreviewModalProps {
  isOpen: boolean;
  documentId: number | null;
  filename: string;
  fileType: string;
  targetPage: number;
  highlightTerm?: string;
  matchedText?: string;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  isOpen,
  documentId,
  filename,
  fileType,
  targetPage,
  highlightTerm = '',
  matchedText = '',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'segments'>('preview');
  const [segments, setSegments] = useState<DocumentSegment[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Highlighting & page navigation state
  const [activeHighlight, setActiveHighlight] = useState<boolean>(true);
  const [selectedPage, setSelectedPage] = useState<number>(targetPage || 1);
  const [searchLocations, setSearchLocations] = useState<DocumentSearchLocation[]>([]);
  const [pagesWithMatches, setPagesWithMatches] = useState<number[]>([]);

  const targetSegmentRef = useRef<HTMLDivElement | null>(null);

  const activeTerm = (highlightTerm || matchedText || '').trim();

  useEffect(() => {
    if (isOpen && documentId) {
      setSelectedPage(targetPage || 1);
      setActiveHighlight(Boolean(activeTerm));
      setActiveTab(fileType === 'docx' ? 'segments' : 'preview');

      loadSegments(documentId);

      if (fileType === 'pdf' && activeTerm) {
        loadSearchLocations(documentId, activeTerm);
      } else {
        setSearchLocations([]);
        setPagesWithMatches([]);
      }
    } else {
      setSegments([]);
      setSearchLocations([]);
      setPagesWithMatches([]);
      setError(null);
    }
  }, [isOpen, documentId, fileType, targetPage, activeTerm]);

  useEffect(() => {
    // When segments load and we are on segments tab, auto-scroll to the target segment
    if (activeTab === 'segments' && targetSegmentRef.current) {
      setTimeout(() => {
        targetSegmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [activeTab, segments, targetPage]);

  const loadSegments = async (id: number) => {
    setLoadingSegments(true);
    setError(null);
    try {
      const data = await getDocumentSegments(id);
      setSegments(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load document text segments.');
    } finally {
      setLoadingSegments(false);
    }
  };

  const loadSearchLocations = async (id: number, term: string) => {
    try {
      const locData = await fetchDocumentSearchLocations(id, term);
      setSearchLocations(locData.locations || []);
      setPagesWithMatches(locData.pages_with_matches || []);
    } catch (err) {
      console.warn('Failed to load search coordinates for PDF:', err);
    }
  };

  if (!isOpen || !documentId) return null;

  // Build the PDF preview URL
  const effectiveHighlightTerm = activeHighlight ? activeTerm : '';
  const baseContentUrl = getDocumentContentUrl(documentId, effectiveHighlightTerm);
  const pdfPreviewUrl =
    fileType === 'pdf'
      ? activeTerm
        ? `${baseContentUrl}#page=${selectedPage}&search="${encodeURIComponent(activeTerm)}"`
        : `${baseContentUrl}#page=${selectedPage}`
      : baseContentUrl;

  const downloadHighlightedUrl = getDocumentContentUrl(documentId, activeTerm, true);
  const rawFileUrl = getDocumentContentUrl(documentId);

  // Helper to highlight terms inside plain text chunks
  const renderHighlightedText = (content: string, term: string) => {
    if (!term) return <span>{content}</span>;
    try {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = content.split(new RegExp(`(${escaped})`, 'gi'));
      return (
        <span>
          {parts.map((part, idx) =>
            part.toLowerCase() === term.toLowerCase() ? (
              <mark key={idx} className="matched-highlight">
                {part}
              </mark>
            ) : (
              <React.Fragment key={idx}>{part}</React.Fragment>
            )
          )}
        </span>
      );
    } catch {
      return <span>{content}</span>;
    }
  };

  const matchesOnCurrentPage = searchLocations.filter(
    (l) => l.page === selectedPage
  ).length;

  return (
    <div className="modal-overlay">
      <div className="modal-content large" style={{ display: 'flex', flexDirection: 'column', height: '90vh' }}>
        {/* Modal Header */}
        <div className="modal-header" style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
            <FileText size={22} color="#0284c7" style={{ flexShrink: 0 }} />
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--secondary)' }}>
                  {filename}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    backgroundColor: '#e0f2fe',
                    color: '#0369a1',
                  }}
                >
                  {fileType}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>
                  Target: {fileType === 'pdf' ? `Page ${selectedPage}` : `Paragraph ${targetPage}`}
                </span>
                {activeTerm && (
                  <>
                    <span>•</span>
                    <span className="highlight-badge-pill">
                      <Sparkles size={11} />
                      Highlighting: "{activeTerm}"
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action & Toggle Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* View Switcher Tabs */}
            <div
              style={{
                display: 'flex',
                background: '#f1f5f9',
                padding: '0.2rem',
                borderRadius: 'var(--radius)',
              }}
            >
              <button
                className={`btn btn-sm ${activeTab === 'preview' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ border: 'none', boxShadow: 'none' }}
                onClick={() => setActiveTab('preview')}
              >
                <Eye size={13} />
                <span>{fileType === 'pdf' ? 'PDF Viewer' : 'Original File'}</span>
              </button>
              <button
                className={`btn btn-sm ${activeTab === 'segments' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ border: 'none', boxShadow: 'none' }}
                onClick={() => setActiveTab('segments')}
              >
                <Layers size={13} />
                <span>Indexed Text ({segments.length})</span>
              </button>
            </div>

            {/* If PDF and has search term, show highlight toggle */}
            {fileType === 'pdf' && activeTerm && activeTab === 'preview' && (
              <button
                className={`btn btn-sm ${activeHighlight ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveHighlight(!activeHighlight)}
                title={activeHighlight ? 'Turn off PDF highlighting' : 'Turn on PDF highlighting'}
                style={{
                  backgroundColor: activeHighlight ? '#f59e0b' : '#f1f5f9',
                  color: activeHighlight ? '#ffffff' : '#475569',
                  border: 'none',
                }}
              >
                <Highlighter size={13} />
                <span>{activeHighlight ? 'Highlights ON' : 'Highlights OFF'}</span>
              </button>
            )}

            {/* Download Button */}
            {fileType === 'pdf' && activeTerm ? (
              <a
                href={downloadHighlightedUrl}
                download
                className="btn btn-secondary btn-sm"
                title="Download PDF with exact highlights burned in"
              >
                <Download size={13} />
                <span>Highlighted PDF</span>
              </a>
            ) : (
              <a
                href={rawFileUrl}
                download
                className="btn btn-secondary btn-sm"
                title="Download original file"
              >
                <Download size={13} />
              </a>
            )}

            <a
              href={pdfPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              title="Open document in new browser tab"
            >
              <ExternalLink size={13} />
            </a>

            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#64748b',
                padding: '0.25rem',
              }}
              title="Close Preview"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Sub-header banner for PDF Page jumping and highlight status */}
        {fileType === 'pdf' && activeTab === 'preview' && activeTerm && (
          <div
            style={{
              padding: '0.5rem 1.25rem',
              background: '#fffbeb',
              borderBottom: '1px solid #fef08a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8125rem',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#92400e', fontWeight: 600 }}>
                Exact Search Highlights in PDF:
              </span>
              <span style={{ color: '#b45309' }}>
                {searchLocations.length > 0 ? (
                  <>
                    <strong>{searchLocations.length}</strong> total occurrence(s) across{' '}
                    <strong>{pagesWithMatches.length}</strong> page(s).
                    {matchesOnCurrentPage > 0 && (
                      <span style={{ marginLeft: '4px' }}>
                        (<strong>{matchesOnCurrentPage}</strong> on Page {selectedPage})
                      </span>
                    )}
                  </>
                ) : (
                  'Highlight layer applied directly to matching coordinates.'
                )}
              </span>
            </div>

            {/* Quick Page Jump Buttons */}
            {pagesWithMatches.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ color: '#78350f', fontSize: '0.75rem', fontWeight: 600 }}>
                  Jump to Page:
                </span>
                {pagesWithMatches.map((pageNum) => {
                  const countOnP = searchLocations.filter((l) => l.page === pageNum).length;
                  return (
                    <button
                      key={pageNum}
                      className={`pdf-jump-btn ${selectedPage === pageNum ? 'active' : ''}`}
                      onClick={() => setSelectedPage(pageNum)}
                      title={`Jump to Page ${pageNum} (${countOnP} matches)`}
                    >
                      <span>Page {pageNum}</span>
                      <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>({countOnP})</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-body" style={{ flex: 1, padding: activeTab === 'preview' ? 0 : '1.25rem', overflowY: 'auto' }}>
          {activeTab === 'preview' ? (
            fileType === 'pdf' ? (
              <iframe
                key={`${pdfPreviewUrl}-${selectedPage}-${activeHighlight}`}
                src={pdfPreviewUrl}
                title="Document PDF Preview"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            ) : fileType === 'txt' ? (
              <div style={{ padding: '1.5rem', background: '#ffffff', minHeight: '100%' }}>
                <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', background: '#f8fafc', borderRadius: '4px', fontSize: '0.8125rem', color: '#64748b' }}>
                  Plain Text Document Preview with Live Highlighting:
                </div>
                {segments.map((seg) => (
                  <pre
                    key={seg.id}
                    style={{
                      fontFamily: 'inherit',
                      fontSize: '0.9375rem',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      color: 'var(--text-main)',
                    }}
                  >
                    {renderHighlightedText(seg.content, activeTerm)}
                  </pre>
                ))}
              </div>
            ) : (
              /* DOCX Fallback Notice */
              <div style={{ padding: '3.5rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <FileText size={42} color="#94a3b8" style={{ margin: '0 auto 1rem auto' }} />
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--secondary)', marginBottom: '0.5rem' }}>
                  Direct Inline Preview for DOCX
                </h3>
                <p style={{ maxWidth: '480px', margin: '0 auto 1.5rem auto', fontSize: '0.875rem', lineHeight: 1.6 }}>
                  Browsers do not support native inline viewing of Word documents. You can inspect all fully extracted text segments with highlighted search terms in the <strong>Indexed Text</strong> tab, or download the original file.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('segments')}>
                    <Layers size={14} />
                    <span>View Extracted Text Segments</span>
                  </button>
                  <a href={rawFileUrl} download={filename} className="btn btn-secondary btn-sm">
                    <Download size={14} />
                    <span>Download DOCX</span>
                  </a>
                </div>
              </div>
            )
          ) : (
            /* Indexed Text Segments Tab */
            <div>
              {loadingSegments ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading text segments...
                </div>
              ) : error ? (
                <div className="alert alert-danger">{error}</div>
              ) : segments.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No indexed text segments found for this document.
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      fontSize: '0.8125rem',
                      color: 'var(--text-muted)',
                      marginBottom: '1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      Showing {segments.length} indexed segment(s). Search terms are highlighted in yellow.
                    </span>
                    {activeTerm && (
                      <span className="highlight-badge-pill">
                        <Highlighter size={12} />
                        Filter: "{activeTerm}"
                      </span>
                    )}
                  </div>

                  {segments.map((seg) => {
                    const isTarget = seg.page_number === targetPage;
                    return (
                      <div
                        key={seg.id}
                        ref={isTarget ? targetSegmentRef : null}
                        className="segment-block"
                        style={{
                          borderColor: isTarget ? '#0284c7' : 'var(--border)',
                          backgroundColor: isTarget ? '#f0f9ff' : '#ffffff',
                          boxShadow: isTarget ? '0 0 0 2px rgba(2, 132, 199, 0.2)' : 'none',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <div className="segment-header">
                          <span
                            style={{
                              color: isTarget ? '#0369a1' : 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                            }}
                          >
                            {isTarget && <CheckCircle2 size={13} color="#0284c7" />}
                            {seg.segment_type.toUpperCase()} {seg.page_number}{' '}
                            {isTarget && '(Target Match Location)'}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            Extraction: {seg.extraction_method.toUpperCase()}
                          </span>
                        </div>
                        <div className="segment-text" style={{ lineHeight: 1.7 }}>
                          {renderHighlightedText(seg.content, activeTerm)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
