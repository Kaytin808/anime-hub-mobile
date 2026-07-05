export {};

declare global {
  interface Window {
    desktopPlayer?: {
      play: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; player?: string }>;
      control?: (payload: { command: string; value?: unknown }) => Promise<{ ok: boolean; error?: string }>;
      getCapabilities?: () => Promise<{ embedded?: boolean; popupFallback?: boolean; inline?: boolean }>;
      log?: (message: string, details?: unknown) => Promise<{ ok: boolean }>;
      onState?: (
        callback: (state: {
          currentTime?: number;
          duration?: number;
          paused?: boolean;
          subtitleVisible?: boolean;
          subtitleTrackId?: number | string | null;
          audioTrackId?: number | string | null;
          trackList?: Array<Record<string, unknown>>;
          lastError?: string;
          title?: string;
        }) => void
      ) => (() => void);
    };
  }
}
