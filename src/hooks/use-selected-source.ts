/**
 * Hook for managing selected screen/window source state.
 * Polls Electron API for currently selected capture source.
 */
import { useState, useEffect, useCallback } from 'react';

interface UseSelectedSourceReturn {
  /** Selected source display name */
  sourceName: string;
  /** Whether a source has been selected */
  hasSelectedSource: boolean;
  /** Open source selector window */
  openSourceSelector: () => void;
}

/** Polling interval for checking selected source (ms) */
const SOURCE_POLL_INTERVAL = 500;

/**
 * Tracks selected screen/window capture source.
 * Polls Electron API at regular intervals to sync state.
 */
export function useSelectedSource(): UseSelectedSourceReturn {
  const [sourceName, setSourceName] = useState('Screen');
  const [hasSelectedSource, setHasSelectedSource] = useState(false);

  useEffect(() => {
    const checkSelectedSource = async () => {
      if (!window.electronAPI?.getSelectedSource) return;

      try {
        const source = await window.electronAPI.getSelectedSource();
        if (source) {
          setSourceName(source.name);
          setHasSelectedSource(true);
        } else {
          setSourceName('Screen');
          setHasSelectedSource(false);
        }
      } catch (err) {
        console.error('Failed to get selected source:', err);
      }
    };

    checkSelectedSource();
    const interval = setInterval(checkSelectedSource, SOURCE_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const openSourceSelector = useCallback(() => {
    if (window.electronAPI?.openSourceSelector) {
      window.electronAPI.openSourceSelector();
    }
  }, []);

  return {
    sourceName,
    hasSelectedSource,
    openSourceSelector,
  };
}
