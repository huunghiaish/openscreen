/**
 * Hook for capturing system audio on macOS 13.2+ via ScreenCaptureKit.
 * Provides audio stream extraction from desktop capture, level metering,
 * and recording to separate WebM file.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { supportsSystemAudio, getSystemAudioSupportMessage } from '@/lib/platform-utils';
import { selectAudioMimeType } from '@/lib/recording-constants';
import {
  SYSTEM_AUDIO_BITRATE,
  captureSystemAudio,
  setupAudioLevelMeter,
  cleanupAudioResources,
  getAudioLevel,
  stopMediaRecorderSafely,
  type AudioCaptureResources,
} from '@/lib/audio-capture-utils';

export interface UseSystemAudioCaptureReturn {
  /** Whether system audio capture is supported on this platform */
  supported: boolean;
  /** Message explaining why system audio is unavailable */
  unsupportedMessage: string | null;
  /** Active audio stream (null if not capturing) */
  stream: MediaStream | null;
  /** Whether currently recording */
  recording: boolean;
  /** Real-time audio level 0-100 for VU meter */
  audioLevel: number;
  /** Start capturing system audio from the given screen source */
  startCapture: (screenSourceId: string) => Promise<boolean>;
  /** Stop capturing and release resources */
  stopCapture: () => void;
  /** Begin recording the captured audio */
  startRecording: () => void;
  /** Stop recording and return the audio blob */
  stopRecording: () => Promise<Blob | null>;
  /** Error message if capture failed */
  error: string | null;
}

export function useSystemAudioCapture(): UseSystemAudioCaptureReturn {
  const [supported, setSupported] = useState(false);
  const [unsupportedMessage, setUnsupportedMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioResources = useRef<AudioCaptureResources | null>(null);
  const chunks = useRef<Blob[]>([]);
  const animationFrame = useRef<number | null>(null);
  const mimeType = useRef<string>('');

  // Check system audio support on mount
  useEffect(() => {
    const isSupported = supportsSystemAudio();
    setSupported(isSupported);
    if (!isSupported) {
      setUnsupportedMessage(getSystemAudioSupportMessage());
    }
  }, []);

  // Update audio level at ~60fps for VU meter display
  const updateAudioLevel = useCallback(() => {
    if (!audioResources.current?.analyser) return;
    setAudioLevel(getAudioLevel(audioResources.current.analyser));
    animationFrame.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  /**
   * Start capturing system audio from the given screen source.
   * Extracts audio track from desktop capture stream.
   */
  const startCapture = useCallback(
    async (screenSourceId: string): Promise<boolean> => {
      if (!supported) {
        setError(unsupportedMessage || 'System audio not supported');
        return false;
      }

      try {
        setError(null);

        const audioStream = await captureSystemAudio(screenSourceId);
        if (!audioStream) {
          setError(
            'No system audio track available. Check System Preferences > Privacy > Screen Recording.'
          );
          return false;
        }

        setStream(audioStream);

        // Setup level metering with proper resource tracking
        audioResources.current = setupAudioLevelMeter(audioStream);
        updateAudioLevel();

        return true;
      } catch (err) {
        console.error('System audio capture failed:', err);
        setError(err instanceof Error ? err.message : 'System audio capture failed');
        return false;
      }
    },
    [supported, unsupportedMessage, updateAudioLevel]
  );

  /** Stop capturing and clean up all resources */
  const stopCapture = useCallback(() => {
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }

    cleanupAudioResources(audioResources.current);
    audioResources.current = null;
    setStream(null);

    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
    mediaRecorder.current = null;

    setRecording(false);
    setAudioLevel(0);
  }, []);

  /** Start recording the captured system audio stream */
  const startRecording = useCallback(() => {
    if (!stream) return;

    chunks.current = [];
    mimeType.current = selectAudioMimeType();

    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType.current,
      audioBitsPerSecond: SYSTEM_AUDIO_BITRATE,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };

    mediaRecorder.current = recorder;
    recorder.start(1000); // Collect data every second
    setRecording(true);
  }, [stream]);

  /** Stop recording and return the audio blob with timeout protection */
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const blob = await stopMediaRecorderSafely(
      mediaRecorder.current,
      chunks.current,
      mimeType.current
    );
    chunks.current = [];
    setRecording(false);
    return blob;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      cleanupAudioResources(audioResources.current);
    };
  }, []);

  return {
    supported,
    unsupportedMessage,
    stream,
    recording,
    audioLevel,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    error,
  };
}
