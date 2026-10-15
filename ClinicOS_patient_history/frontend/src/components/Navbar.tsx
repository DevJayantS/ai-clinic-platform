import React from 'react';
import { Hospital, RefreshCw } from 'lucide-react';
import type { SystemStatus } from '../types';

interface NavbarProps {
  status: SystemStatus | null;
  onNavigateHome: () => void;
  onReseed: () => void;
  isReseeding: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  onNavigateHome,
  onReseed,
  isReseeding,
}) => {
  return (
    <header className="navbar">
      <div className="nav-brand" style={{ cursor: 'pointer' }} onClick={onNavigateHome}>
        <Hospital className="text-primary" size={24} color="#0284c7" />
        <span>ClinicOS</span>
        <span className="badge-tag">DocSearch Module</span>
      </div>

      <div className="nav-actions">
        {status && (
          <div
            className="status-pill"
            title={status.ocr_available ? status.ocr_engine : "OCR engine not detected on system PATH. Direct text extraction active."}
          >
            <span className={`status-dot ${status.ocr_available ? 'green' : 'amber'}`} />
            <span>OCR: {status.ocr_available ? 'Active' : 'Offline (Direct Extraction Only)'}</span>
          </div>
        )}

        <button
          className="btn btn-secondary btn-sm"
          onClick={onReseed}
          disabled={isReseeding}
          title="Reset and reload synthetic demonstration patients & reports"
        >
          <RefreshCw size={14} className={isReseeding ? 'animate-spin' : ''} />
          {isReseeding ? 'Resetting Demo...' : 'Reset Demo Records'}
        </button>
      </div>
    </header>
  );
};
