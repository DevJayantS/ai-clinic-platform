import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '3rem 1.5rem', maxWidth: '640px', margin: '3rem auto', textAlign: 'center' }}>
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '2rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'inline-flex', padding: '0.75rem', background: '#fee2e2', borderRadius: '50%', marginBottom: '1rem' }}>
              <AlertTriangle size={32} color="#dc2626" />
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#991b1b', marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#7f1d1d', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                padding: '0.6rem 1.2rem',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={16} />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
