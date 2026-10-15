import React, { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { PatientDashboard } from './components/PatientDashboard';
import { PatientWorkspace } from './components/PatientWorkspace';
import { CreatePatientModal } from './components/CreatePatientModal';
import type { Patient, SystemStatus, PatientCreate } from './types';
import {
  fetchPatients,
  fetchSystemStatus,
  createPatient,
  deletePatient,
  seedDemoDataApi,
} from './services/api';
import './styles/app.css';

export const App: React.FC = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReseeding, setIsReseeding] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    setBackendError(null);
    try {
      const [patList, sysStatus] = await Promise.all([
        fetchPatients(),
        fetchSystemStatus(),
      ]);
      setPatients(patList);
      setSystemStatus(sysStatus);
    } catch (err: any) {
      console.error('Failed to load initial data:', err);
      setBackendError(
        'Unable to connect to the ClinicOS backend service. Ensure the FastAPI server is running on http://127.0.0.1:8000.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
  };

  const handleBackToDashboard = () => {
    setSelectedPatient(null);
    loadInitialData(); // Refresh patient counts
  };

  const handleCreatePatient = async (payload: PatientCreate) => {
    const newPat = await createPatient(payload);
    await loadInitialData();
    setSelectedPatient(newPat);
  };

  const handleDeletePatient = async (patientId: number) => {
    try {
      await deletePatient(patientId);
      if (selectedPatient?.id === patientId) {
        setSelectedPatient(null);
      }
      await loadInitialData();
    } catch (err: any) {
      alert(`Failed to delete patient: ${err.message}`);
    }
  };

  const handleReseed = async () => {
    setIsReseeding(true);
    try {
      await seedDemoDataApi();
      await loadInitialData();
      if (selectedPatient) {
        // Re-sync selected patient
        const updated = await fetchPatients();
        const found = updated.find((p) => p.id === selectedPatient.id);
        setSelectedPatient(found || null);
      }
    } catch (err: any) {
      alert(`Reseed failed: ${err.message}`);
    } finally {
      setIsReseeding(false);
    }
  };

  return (
    <div className="app-container">
      <Navbar
        status={systemStatus}
        onNavigateHome={handleBackToDashboard}
        onReseed={handleReseed}
        isReseeding={isReseeding}
      />

      <main className="main-content">
        {backendError && (
          <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
            <div>
              <strong>Connection Error: </strong>
              {backendError}
            </div>
          </div>
        )}

        {selectedPatient ? (
          <PatientWorkspace
            patient={selectedPatient}
            onBack={handleBackToDashboard}
          />
        ) : (
          <PatientDashboard
            patients={patients}
            onSelectPatient={handleSelectPatient}
            onOpenCreateModal={() => setIsCreateModalOpen(true)}
            onDeletePatient={handleDeletePatient}
            loading={loading}
          />
        )}
      </main>

      <CreatePatientModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreatePatient}
      />
    </div>
  );
};

export default App;
