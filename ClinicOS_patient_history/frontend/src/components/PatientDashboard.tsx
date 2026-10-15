import React, { useState } from 'react';
import { Search, UserPlus, Users, FileText, ArrowRight, Trash2 } from 'lucide-react';
import type { Patient } from '../types';

interface PatientDashboardProps {
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  onOpenCreateModal: () => void;
  onDeletePatient: (patientId: number) => void;
  loading: boolean;
}

export const PatientDashboard: React.FC<PatientDashboardProps> = ({
  patients,
  onSelectPatient,
  onOpenCreateModal,
  onDeletePatient,
  loading,
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  const filteredPatients = patients.filter(
    (p) =>
      p.patient_code.toLowerCase().includes(filterQuery.toLowerCase()) ||
      p.display_name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const totalDocs = patients.reduce((acc, p) => acc + p.document_count, 0);

  return (
    <div>
      {/* Top Banner & Stats */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--secondary)' }}>
              Patient Medical Records Search
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginTop: '0.25rem' }}>
              Select a patient to search across all their uploaded clinical reports, discharge summaries, and lab documents.
            </p>
          </div>
          <button className="btn btn-primary" onClick={onOpenCreateModal}>
            <UserPlus size={16} />
            <span>New Patient</span>
          </button>
        </div>

        {/* Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ padding: '0.5rem', background: 'var(--primary-light)', borderRadius: 'var(--radius)' }}>
                <Users size={20} color="#0284c7" />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Total Patients
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--secondary)' }}>
                  {patients.length}
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ padding: '0.5rem', background: '#ecfdf5', borderRadius: 'var(--radius)' }}>
                <FileText size={20} color="#10b981" />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Indexed Documents
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--secondary)' }}>
                  {totalDocs}
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ padding: '0.5rem', background: '#fef3c7', borderRadius: 'var(--radius)' }}>
                <Search size={20} color="#b45309" />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Search Isolation
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--secondary)', marginTop: '0.25rem' }}>
                  Strict Patient Scoping
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Patients Table Card */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ fontWeight: 600 }}>Patients Directory</div>
          <div style={{ position: 'relative', minWidth: '260px' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
            />
            <input
              type="text"
              className="form-control"
              placeholder="Filter by code or name..."
              style={{ paddingLeft: '2.25rem' }}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="table-container">
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading patient directory...
            </div>
          ) : filteredPatients.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                {filterQuery ? 'No patients match your search filter.' : 'No patients found. Create one or click "Reset Demo Records".'}
              </p>
              {!filterQuery && (
                <button className="btn btn-primary btn-sm" onClick={onOpenCreateModal}>
                  <UserPlus size={14} />
                  <span>Create First Patient</span>
                </button>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th>Display Name</th>
                  <th>Associated Documents</th>
                  <th>Registered</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: 'var(--primary-dark)',
                          background: 'var(--primary-light)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.8125rem',
                        }}
                      >
                        {p.patient_code}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.display_name}</td>
                    <td>
                      <span className="badge badge-page">
                        {p.document_count} {p.document_count === 1 ? 'Report' : 'Reports'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => onSelectPatient(p)}
                          title="Open document workspace and search"
                        >
                          <span>Open Workspace</span>
                          <ArrowRight size={14} />
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete ${p.patient_code} (${p.display_name}) and all associated records?`)) {
                              onDeletePatient(p.id);
                            }
                          }}
                          title="Delete patient and records"
                        >
                          <Trash2 size={14} />
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
  );
};
