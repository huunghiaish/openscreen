/**
 * Microphone capture hook with real-time audio level metering.
 * Manages getUserMedia audio stream, Web Audio API analyzer for VU meter,
 * and MediaRecorder for saving mic audio to separate file.
 *
 * Audio recorded as WebM with Opus codec for efficient encoding and small file size.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseMicrophoneCaptureReturn {
  /** Current microphone MediaStream or null if not capturing */
  stream: MediaStream | null;
  /** Whether currently recording audio */
  recording: boolean;
  /** Real-time audio level 0-100 for VU meter display */
  audioLevel: number;
  /** Start capturing from specified device */
  startCapture: (deviceId: string) => Promise<void>;
  /** Stop capture and release resources */
  stopCapture: () => void;
  /** Begin recording audio to blob */
  startRecording: () => void;
  /** Stop recording and return audio blob */
  stopRecording: () => Promise<Blob | null>;
  /** Error message if capture failed */
  error: string | null;
}

export function useMicrophoneCapture(): UseMicrophoneCaptureReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const chunks = useRef<Blob[]>([]);
  const animationFrame = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null); // Use ref to avoid callback dependency issues
  const recordingPromise = useRef<{
    resolve: (blob: Blob | null) => void;
  } | null>(null);

  /**
   * Calculate RMS audio level from time-domain data.
   * Updates at ~60fps for smooth VU meter animation.
   */
  const updateAudioLevel = useCallback(() => {
    if (!analyser.current) return;

    const dataArray = new Uint8Array(analyser.current.fftSize);
    analyser.current.getByteTimeDomainData(dataArray);

    // Calculate RMS (root mean square) level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      // Normalize from 0-255 to -1 to 1
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    // Scale RMS to 0-100 range for display (multiply by 300 for sensitivity)
    const level = Math.min(100, Math.round(rms * 300));

    setAudioLevel(level);
    animationFrame.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  /**
   * Start capturing audio from specified microphone device.
   * Sets up AudioContext + AnalyserNode for level metering.
   */
  const startCapture = useCallback(async (deviceId: string) => {
    try {
      setError(null);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);

      // Setup Web Audio API for real-time level metering
      audioContext.current = new AudioContext();

      // Resume AudioContext if suspended (browser security policy)
      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }

      const source = audioContext.current.createMediaStreamSource(mediaStream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 256; // Small FFT for fast updates
      source.connect(analyser.current);

      // Start continuous level metering at ~60fps
      updateAudioLevel();
    } catch (err) {
      console.error('Microphone capture failed:', err);
      setError(err instanceof Error ? err.message : 'Microphone capture failed');
    }
  }, [updateAudioLevel]);

  /**
   * Stop capture and release all resources.
   * Uses ref to avoid callback dependency changes that cause infinite loops.
   */
  const stopCapture = useCallback(() => {
    // Stop level metering animation
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }

    // Close audio context
    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
      analyser.current = null;
    }

    // Stop media stream tracks (use ref to avoid dependency issues)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
    }

    // Stop recorder if running
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }

    setRecording(false);
    setAudioLevel(0);
  }, []); // Empty deps - uses refs instead

  /**
   * Begin recording audio. Must call startCapture first.
   * Records to WebM with Opus codec for efficient encoding.
   */
  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    const currentStream = streamRef.current;

    chunks.current = [];

    // Prefer Opus codec for efficient audio encoding
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(currentStream, {
      mimeType,
      audioBitsPerSecond: 128_000, // 128 kbps - good quality, small file
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks.current, { type: mimeType });
      chunks.current = [];
      if (recordingPromise.current) {
        recordingPromise.current.resolve(blob);
        recordingPromise.current = null;
      }
      setRecording(false);
    };

    mediaRecorder.current = recorder;
    recorder.start(1000); // Collect data every second
    setRecording(true);
  }, []); // Empty deps - uses refs instead

  /**
   * Stop recording and return the audio blob.
   * Returns null if not currently recording.
   */
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorder.current || mediaRecorder.current.state !== 'recording') {
        resolve(null);
        return;
      }
      recordingPromise.current = { resolve };
      mediaRecorder.current.stop();
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      if (audioContext.current) {
        audioContext.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Empty deps - cleanup refs on unmount only

  return {
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
