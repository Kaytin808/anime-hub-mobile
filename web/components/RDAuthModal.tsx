import { useState, useEffect, useRef } from 'react';

type RDAuthModalProps = {
  onClose: () => void;
  onStartAuth: () => Promise<{ verification_url: string; user_code: string; direct_verification_url?: string } | null>;
  status: 'disconnected' | 'waiting' | 'connected';
};

export default function RDAuthModal({ onClose, onStartAuth, status }: RDAuthModalProps) {
  const [authData, setAuthData] = useState<{
    verification_url: string;
    user_code: string;
    direct_verification_url?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const didStartAuth = useRef(false);

  useEffect(() => {
    if (status === 'connected') {
      onClose();
      return;
    }

    if (!authData && !didStartAuth.current) {
      didStartAuth.current = true;
      void (async () => {
        const data = await onStartAuth();
        if (data) setAuthData(data);
        else setError('Failed to start authentication');
      })();
    }
  }, [authData, onStartAuth, onClose, status]);

  const handleOpenUrl = () => {
    const url = authData?.direct_verification_url || authData?.verification_url;
    if (url) window.open(url, '_blank');
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modalHeader">
          <h2>Connect RealDebrid</h2>
          <button className="closeBtn" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody" style={{ padding: 24, textAlign: 'center' }}>
          {error && <div className="notice">{error}</div>}

          {authData && (
            <>
              <div style={{ fontSize: 42, marginBottom: 12 }}>🔑</div>
              <p style={{ color: '#a8b3c5', marginBottom: 16, fontSize: 14 }}>
                Enter this code on the RealDebrid website to connect your account.
              </p>

              <div
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: '#e6b450',
                  letterSpacing: 6,
                  background: '#0f1115',
                  padding: '12px 20px',
                  borderRadius: 8,
                  display: 'inline-block',
                  marginBottom: 20,
                  fontFamily: 'monospace'
                }}
              >
                {authData.user_code}
              </div>

              <button
                onClick={handleOpenUrl}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  border: '2px solid #e6b450',
                  background: '#e6b450',
                  color: '#17120a',
                  fontWeight: 800,
                  fontSize: 15,
                  marginBottom: 12
                }}
              >
                Open RealDebrid
              </button>

              <p style={{ fontSize: 12, color: '#8a95a8' }}>
                Waiting for authorization{status === 'waiting' ? '...' : ''}
              </p>
            </>
          )}

          {!authData && !error && (
            <div>
              <div className="loadingDot" />
              <div className="loadingDot" />
              <div className="loadingDot" />
              <p style={{ marginTop: 12, color: '#a8b3c5', fontSize: 14 }}>Starting authentication...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
