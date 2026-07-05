import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type DeviceAuthStart = {
  device_code: string;
  user_code: string;
  verification_url: string;
  direct_verification_url?: string;
  expires_in: number;
  interval?: number;
};

type RDState = {
  token: string | null;
  deviceCode: string | null;
  status: 'disconnected' | 'waiting' | 'connected';
  pollError: string | null;
};

type RDContextValue = RDState & {
  startAuth: () => Promise<DeviceAuthStart | null>;
  disconnect: () => void;
};

const RealDebridContext = createContext<RDContextValue | null>(null);

const STORAGE_KEY = 'rd_access_token';

export function RealDebridProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RDState>({
    token: null,
    deviceCode: null,
    status: 'disconnected',
    pollError: null
  });

  const setToken = useCallback((token: string | null) => {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
      setState({ token, deviceCode: null, status: 'connected', pollError: null });
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setState({ token: null, deviceCode: null, status: 'disconnected', pollError: null });
    }
  }, []);

  const startAuth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/realdebrid/start`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to start auth: ${res.status}`);
      }
      if (!data.device_code) throw new Error('Invalid auth response');

      setState((prev) => ({
        ...prev,
        deviceCode: data.device_code,
        status: 'waiting',
        pollError: null
      }));

      return data as DeviceAuthStart;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        pollError: err instanceof Error ? err.message : 'Failed to start auth'
      }));
      return null;
    }
  }, []);

  const disconnect = useCallback(() => {
    setToken(null);
  }, [setToken]);

  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_KEY);
    let cancelled = false;

    const setDisconnected = (message?: string) => {
      localStorage.removeItem(STORAGE_KEY);
      setState((prev) => ({
        ...prev,
        token: null,
        status: 'disconnected',
        pollError: message || null
      }));
    };

    const validateStatus = async (token: string | null, allowServerTokenFallback: boolean) => {
      try {
        const res = await fetch(`${API_URL}/auth/realdebrid/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        });

        if (!res.ok) {
          throw new Error(token ? 'Stored RealDebrid token is no longer valid' : 'RealDebrid is not connected');
        }

        const data = await res.json();
        if (!data.connected) {
          throw new Error('RealDebrid is not connected');
        }

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            token,
            status: 'connected',
            pollError: null
          }));
        }
      } catch (err) {
        if (token && allowServerTokenFallback) {
          localStorage.removeItem(STORAGE_KEY);
          await validateStatus(null, false);
          return;
        }

        if (!cancelled) {
          setDisconnected(token ? (err instanceof Error ? err.message : 'Failed to validate RealDebrid token') : undefined);
        }
      }
    };

    void validateStatus(storedToken, true);

    return () => {
      cancelled = true;
    };
  }, []);

  // Poll for token when waiting
  useEffect(() => {
    if (state.status !== 'waiting' || !state.deviceCode) return;

    const interval = 3000;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      try {
        const res = await fetch(`${API_URL}/auth/realdebrid/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: state.deviceCode })
        });

        if (!res.ok) {
          const body = await res.text();
          // 403 = still waiting, not an error
          if (res.status !== 403) {
            throw new Error(body || `Poll failed: ${res.status}`);
          }
          return; // try again on next interval
        }

        const data = await res.json();
        if (data.access_token) {
          setToken(data.access_token);
          cancelled = true;
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            pollError: err instanceof Error ? err.message : 'Poll failed',
            status: 'disconnected'
          }));
          cancelled = true;
        }
      }
    };

    // initial delay then poll
    const timeout = setTimeout(() => {
      const id = setInterval(poll, interval);
      void poll();
      return () => {
        clearInterval(id);
        cancelled = true;
      };
    }, 2000);

    return () => {
      clearTimeout(timeout);
      cancelled = true;
    };
  }, [state.status, state.deviceCode, setToken]);

  return (
    <RealDebridContext.Provider value={{ ...state, startAuth, disconnect }}>
      {children}
    </RealDebridContext.Provider>
  );
}

export function useRealDebrid() {
  const ctx = useContext(RealDebridContext);
  if (!ctx) throw new Error('useRealDebrid must be inside RealDebridProvider');
  return ctx;
}
