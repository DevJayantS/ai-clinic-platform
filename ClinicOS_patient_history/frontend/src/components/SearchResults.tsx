import React, { useState, useMemo } from 'react';
import {
  FileText,
  ExternalLink,
  Eye,
  AlertTriangle,
  Info,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Layers,
  ListFilter,
} from 'lucide-react';
import type { SearchResponse, SearchOccurrence } from '../types';

interface SearchResultsProps {
  searchResult: SearchResponse | null;
  loading: boolean;
  onPageChange: (newPage: number) => void;
  onPreviewDocument: (
    documentId: number,
    filename: string,
    fileType: string,
    pageNumber: number,
    highlightTerm?: string,
    matchedText?: string
  ) => void;
  onOpenDirectFile: (documentId: number) => void;
}

interface GroupedDocument {
  documentId: number;
  filename: string;
  fileType: string;
  occurrences: SearchOccurrence[];
  pageNumbers: number[];
  hasOcr: boolean;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  searchResult,
  loading,
  onPageChange,
  onPreviewDocument,
  onOpenDirectFile,
}) => {
  // CRITICAL: All React hooks must be declared unconditionally at the very top
  const [viewMode, setViewMode] = useState<'grouped' | 'list'>('grouped');
  const [collapsedDocs, setCollapsedDocs] = useState<Record<number, boolean>>({});

  const toggleDocCollapse = (docId: number) => {
    setCollapsedDocs((prev) => ({
      ...prev,
      [docId]: !prev[docId],
    }));
  };

  // Group search occurrences by document ID so each report appears once
  const groupedDocuments: GroupedDocument[] = useMemo(() => {
    const results = searchResult?.results;
    if (!results || results.length === 0) return [];

    const map = new Map<number, GroupedDocument>();

    for (const occ of results) {
      if (!map.has(occ.document_id)) {
        map.set(occ.document_id, {
          documentId: occ.document_id,
          filename: occ.document_filename,
          fileType: occ.file_type,
          occurrences: [],
          pageNumbers: [],
          hasOcr: false,
        });
      }
      const group = map.get(occ.document_id)!;
      group.occurrences.push(occ);
      if (occ.page_number && !group.pageNumbers.includes(occ.page_number)) {
        group.pageNumbers.push(occ.page_number);
      }
      if (occ.extraction_method === 'ocr') {
        group.hasOcr = true;
      }
    }

    for (const group of map.values()) {
      group.pageNumbers.sort((a, b) => a - b);
    }

    return Array.from(map.values());
  }, [searchResult?.results]);

  // Loading state
  if (loading) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ display: 'inline-block', marginBottom: '0.75rem' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              border: '3px solid #e2e8f0',
              borderTopColor: '#0284c7',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
        <p style={{ fontWeight: 600 }}>Searching patient's indexed documents...</p>
      </div>
    );
  }

  // No search submitted yet
  if (!searchResult) {
    return null;
  }

  const {
    query,
    total_matches,
    matching_documents_count,
    total_searched_documents,
    page,
    page_size,
    total_pages,
    results,
    warnings,
  } = searchResult;

  // Render context excerpt with safely highlighted matched term
  const renderHighlightedExcerpt = (excerpt: string, matchedText: string) => {
    if (!matchedText) return <span>{excerpt}</span>;

    try {
      const escaped = matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = excerpt.split(new RegExp(`(${escaped})`, 'gi'));
      return (
        <span>
          {parts.map((part, i) =>
            part.toLowerCase() === matchedText.toLowerCase() ? (
              <mark key={i} className="matched-highlight">
                {part}
              </mark>
            ) : (
              <React.Fragment key={i}>{part}</React.Fragment>
            )
          )}
        </span>
      );
    } catch {
      return <span>{excerpt}</span>;
    }
  };

  return (
    <div>
      {/* Warnings & Scope Disclaimers */}
      {warnings && warnings.length > 0 && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Search Scope Notice:</div>
            {warnings.map((w, idx) => (
              <div key={idx}>{w}</div>
            ))}
          </div>
        </div>
      )}

      {/* Result Stats Banner */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          marginBottom: '1.25rem',
          background: total_matches > 0 ? '#f0fdf4' : '#f8fafc',
          borderColor: total_matches > 0 ? '#bbf7d0' : 'var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Query: </span>
            <strong style={{ color: 'var(--secondary)' }}>"{query}"</strong>
            <span style={{ margin: '0 0.5rem', color: 'var(--text-muted)' }}>•</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Total Matches: </span>
            <strong style={{ color: total_matches > 0 ? '#15803d' : 'var(--text-main)' }}>
              {total_matches} {total_matches === 1 ? 'occurrence' : 'occurrences'}
            </strong>
            <span style={{ margin: '0 0.5rem', color: 'var(--text-muted)' }}>•</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Matching Reports: </span>
            <strong style={{ color: '#0284c7' }}>
              {matching_documents_count} {matching_documents_count === 1 ? 'report' : 'reports'}
            </strong>
          </div>

          {/* View Mode Toggle Controls */}
          {total_matches > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>
                View:
              </span>
              <button
                className={`btn btn-sm ${viewMode === 'grouped' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setViewMode('grouped')}
                title="Group occurrences by document so each report is listed once"
                style={{ fontSize: '0.75rem' }}
              >
                <Layers size={13} />
                <span>Grouped by Report ({groupedDocuments.length})</span>
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setViewMode('list')}
                title="Show all occurrences as individual entries"
                style={{ fontSize: '0.75rem' }}
              >
                <ListFilter size={13} />
                <span>All Occurrences ({total_matches})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Empty State */}
      {total_matches === 0 ? (
        <div className="card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
          <div style={{ maxWidth: '520px', margin: '0 auto' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                background: '#f1f5f9',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem auto',
              }}
            >
              <Info size={24} color="#64748b" />
            </div>
            <h3
              style={{
                fontSize: '1.125rem',
                fontWeight: 700,
                color: 'var(--secondary)',
                marginBottom: '0.5rem',
              }}
            >
              No matches found in this patient's medical records.
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              The search query <strong>"{query}"</strong> did not match any text within the{' '}
              {total_searched_documents} processed document(s) for this patient.
            </p>
            <div
              style={{
                marginTop: '1.25rem',
                padding: '0.75rem',
                background: '#f8fafc',
                borderRadius: 'var(--radius)',
                fontSize: '0.8125rem',
                color: '#64748b',
                border: '1px solid var(--border)',
              }}
            >
              Note: This indicates absence of the literal term in the indexed document contents and does
              not represent a diagnostic or clinical medical opinion.
            </div>
          </div>
        </div>
      ) : viewMode === 'grouped' ? (
        /* MODE 1: GROUPED BY REPORT (ONE CARD PER REPORT CONTAINING ALL HIGHLIGHTS) */
        <div>
          {groupedDocuments.map((group) => {
            const isCollapsed = Boolean(collapsedDocs[group.documentId]);
            const matchCount = group.occurrences.length;
            const primaryPage = group.pageNumbers.length > 0 ? group.pageNumbers[0] : 1;

            return (
              <div key={group.documentId} className="doc-result-group">
                {/* Single Document Header */}
                <div className="doc-group-header">
                  <div className="doc-group-title-row">
                    <FileText size={18} color="#0284c7" />
                    <span className="doc-group-filename">{group.filename}</span>

                    <span className="badge badge-match-count">
                      {matchCount} {matchCount === 1 ? 'match' : 'matches'}
                    </span>

                    <span className="badge badge-page">
                      {group.pageNumbers.length > 0
                        ? group.pageNumbers.length === 1
                          ? `Page ${group.pageNumbers[0]}`
                          : `Pages ${group.pageNumbers.join(', ')}`
                        : 'Full Text'}
                    </span>

                    {group.hasOcr && <span className="badge badge-ocr">OCR Extracted</span>}

                    <span
                      className="badge"
                      style={{
                        textTransform: 'uppercase',
                        background: '#f1f5f9',
                        color: '#475569',
                      }}
                    >
                      {group.fileType}
                    </span>
                  </div>

                  {/* Header Actions */}
                  <div className="doc-group-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        onPreviewDocument(
                          group.documentId,
                          group.filename,
                          group.fileType,
                          primaryPage,
                          query
                        )
                      }
                      title={`View ${group.filename} with all ${matchCount} search terms highlighted`}
                    >
                      <Eye size={14} />
                      <span>
                        View {group.fileType.toUpperCase()} ({matchCount}{' '}
                        {matchCount === 1 ? 'Highlight' : 'Highlights'})
                      </span>
                    </button>

                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenDirectFile(group.documentId)}
                      title="Open raw file in a new tab"
                    >
                      <ExternalLink size={13} />
                      <span>Open File</span>
                    </button>

                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggleDocCollapse(group.documentId)}
                      title={isCollapsed ? 'Show matches' : 'Collapse matches'}
                      style={{ padding: '0.25rem 0.4rem' }}
                    >
                      {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                  </div>
                </div>

                {/* All Matching Passages Contained Inside this Report Card */}
                {!isCollapsed && (
                  <div className="doc-matches-container">
                    <div className="doc-matches-subheading">
                      <span>
                        Matched Passages in this Document ({group.occurrences.length}):
                      </span>
                      <span style={{ fontWeight: 500, fontSize: '0.75rem', color: '#94a3b8' }}>
                        Click "Jump to Page" to view specific location
                      </span>
                    </div>

                    <div className="doc-matches-list">
                      {group.occurrences.map((occ, idx) => (
                        <div key={occ.occurrence_id} className="doc-occurrence-item">
                          <div className="doc-occurrence-meta">
                            <span className="doc-occurrence-number">
                              Occurrence {idx + 1} of {group.occurrences.length}
                            </span>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span
                                className="badge badge-page"
                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}
                              >
                                {occ.segment_type === 'page'
                                  ? `Page ${occ.page_number}`
                                  : `Section / Para ${occ.page_number}`}
                              </span>

                              <button
                                className="btn-link-jump"
                                onClick={() =>
                                  onPreviewDocument(
                                    group.documentId,
                                    group.filename,
                                    group.fileType,
                                    occ.page_number,
                                    query,
                                    occ.matched_text
                                  )
                                }
                                title={`Jump directly to Page ${occ.page_number} in document viewer`}
                              >
                                <span>Jump to Page {occ.page_number}</span>
                                <ArrowRight size={12} />
                              </button>
                            </div>
                          </div>

                          {/* Highlighted text excerpt */}
                          <div className="doc-occurrence-excerpt">
                            {renderHighlightedExcerpt(occ.context_excerpt, occ.matched_text)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination Controls */}
          {total_pages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '1.5rem',
                padding: '1rem',
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Showing {(page - 1) * page_size + 1} -{' '}
                {Math.min(page * page_size, total_matches)} of {total_matches} occurrences (across{' '}
                {matching_documents_count} {matching_documents_count === 1 ? 'report' : 'reports'})
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>

                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  Page {page} of {total_pages}
                </span>

                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page >= total_pages}
                  onClick={() => onPageChange(page + 1)}
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* MODE 2: FLAT OCCURRENCES LIST (OPTIONAL VIEW) */
        <div>
          {results.map((occ) => (
            <div key={occ.occurrence_id} className="result-card">
              <div className="result-header">
                <div className="result-doc-info">
                  <FileText size={16} color="#0284c7" />
                  <span>{occ.document_filename}</span>
                </div>

                <div className="result-badges">
                  <span className="badge badge-page">
                    {occ.segment_type === 'page'
                      ? `Page ${occ.page_number}`
                      : `Section / Paragraph ${occ.page_number}`}
                  </span>
                  {occ.extraction_method === 'ocr' && (
                    <span className="badge badge-ocr">OCR Extracted</span>
                  )}
                </div>
              </div>

              {/* Surrounding Context Excerpt */}
              <div className="result-excerpt">
                {renderHighlightedExcerpt(occ.context_excerpt, occ.matched_text)}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    onPreviewDocument(
                      occ.document_id,
                      occ.document_filename,
                      occ.file_type,
                      occ.page_number,
                      query,
                      occ.matched_text
                    )
                  }
                  title="View document with exact search highlights"
                >
                  <Eye size={13} />
                  <span>
                    View{' '}
                    {occ.segment_type === 'page'
                      ? `Page ${occ.page_number}`
                      : 'Document Text'}{' '}
                    (Highlighted)
                  </span>
                </button>

                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenDirectFile(occ.document_id)}
                  title="Open original file in new browser tab"
                >
                  <ExternalLink size={13} />
                  <span>Open File</span>
                </button>
              </div>
            </div>
          ))}

          {/* Pagination Controls */}
          {total_pages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '1.5rem',
                padding: '1rem',
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Showing {(page - 1) * page_size + 1} -{' '}
                {Math.min(page * page_size, total_matches)} of {total_matches} occurrences
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  <ChevronLeft size={14} />
                  <span>Previous</span>
                </button>

                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  Page {page} of {total_pages}
                </span>

                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page >= total_pages}
                  onClick={() => onPageChange(page + 1)}
                >
                  <span>Next</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
