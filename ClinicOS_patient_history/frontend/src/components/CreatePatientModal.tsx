import React, { useState } from 'react';
import { X, UserPlus, AlertCircle } from 'lucide-react';
import type { PatientCreate } from '../types';

interface CreatePatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: PatientCreate) => Promise<void>;
}

export const CreatePatientModal: React.FC<CreatePatientModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [patientCode, setPatientCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Please provide a patient display name.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        patient_code: patientCode.trim() || undefined,
        display_name: displayName.trim(),
      });
      setPatientCode('');
      setDisplayName('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create patient.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <UserPlus size={18} color="#0284c7" />
            <span>Create Synthetic Patient</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="alert alert-danger">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Patient Identifier Code (Optional)</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. PAT-1004 (Auto-generated if empty)"
                value={patientCode}
                onChange={(e) => setPatientCode(e.target.value)}
              />
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Used to isolate and scope medical report searches.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Full Display Name *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Demonstration Patient Four"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Patient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
