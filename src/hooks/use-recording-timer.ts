/**
 * Hook for managing recording duration timer.
 * Tracks elapsed time when recording is active.
 */
import { useState, useEffect, useCallback } from 'react';

interface UseRecordingTimerReturn {
  /** Elapsed time in seconds */
  elapsed: number;
  /** Formatted time string (MM:SS) */
  formattedTime: string;
}

/**
 * Tracks recording duration and provides formatted time string.
 * @param recording - Whether recording is currently active
 */
export function useRecordingTimer(recording: boolean): UseRecordingTimerReturn {
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (recording) {
      if (!recordingStart) setRecordingStart(Date.now());
      timer = setInterval(() => {
        if (recordingStart) {
          setElapsed(Math.floor((Date.now() - recordingStart) / 1000));
        }
      }, 1000);
    } else {
      setRecordingStart(null);
      setElapsed(0);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStart]);

  const formatTime = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  return {
    elapsed,
    formattedTime: formatTime(elapsed),
  };
}
