/**
 * Camera capture hook for recording webcam video independently.
 * Manages getUserMedia stream, MediaRecorder for camera recording.
 *
 * Note: For integrated screen+camera recording, use useScreenRecorder with cameraDeviceId option.
 * This standalone hook is useful for camera-only recording scenarios or UI preview components.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseCameraCaptureReturn {
  stream: MediaStream | null;
  recording: boolean;
  startCapture: (deviceId: string) => Promise<void>;
  stopCapture: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<Blob | null>;
  error: string | null;
}

export function useCameraCapture(): UseCameraCaptureReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingPromise = useRef<{
    resolve: (blob: Blob | null) => void;
  } | null>(null);

  const startCapture = useCallback(async (deviceId: string) => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false, // Audio handled separately in mic capture
      });
      setStream(mediaStream);
    } catch (err) {
      console.error('Camera capture failed:', err);
      setError(err instanceof Error ? err.message : 'Camera capture failed');
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
    setRecording(false);
  }, [stream]);

  const startRecording = useCallback(() => {
    if (!stream) return;

    chunks.current = [];

    // Select best available codec for camera recording
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000, // 2.5 Mbps for camera
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
    recorder.start(1000);
    setRecording(true);
  }, [stream]);

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
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  return {
    stream,
    recording,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    error,
  };
}
