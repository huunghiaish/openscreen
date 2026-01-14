/**
 * Main screen recording hook that orchestrates video, camera, mic, and system audio capture.
 * Stores recordings as separate files for independent control in the editor.
 */
import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import {
  TARGET_FRAME_RATE,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  AUDIO_BITRATE,
  CAMERA_BITRATE,
  CAMERA_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_FRAME_RATE,
  selectVideoMimeType,
  selectAudioMimeType,
  computeVideoBitrate,
} from "@/lib/recording-constants";
import {
  SYSTEM_AUDIO_BITRATE,
  captureSystemAudio,
  setupAudioLevelMeter,
  cleanupAudioResources,
  getAudioLevel,
  stopMediaRecorderSafely,
  type AudioCaptureResources,
} from "@/lib/audio-capture-utils";

interface UseScreenRecorderOptions {
  cameraDeviceId?: string | null;
  micDeviceId?: string | null;
  /** Enable system audio capture (macOS 13.2+ only) */
  systemAudioEnabled?: boolean;
}

type UseScreenRecorderReturn = {
  recording: boolean;
  toggleRecording: () => void;
  cameraStream: MediaStream | null;
  micStream: MediaStream | null;
  micAudioLevel: number;
  /** System audio level 0-100 (macOS 13.2+ only) */
  systemAudioLevel: number;
};

export function useScreenRecorder(options: UseScreenRecorderOptions = {}): UseScreenRecorderReturn {
  const { cameraDeviceId, micDeviceId, systemAudioEnabled = false } = options;

  const [recording, setRecording] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micAudioLevel, setMicAudioLevel] = useState(0);
  const [systemAudioLevel, setSystemAudioLevel] = useState(0);

  // Screen recording refs
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);

  // Camera recording refs
  const cameraRecorder = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraChunks = useRef<Blob[]>([]);

  // Mic recording refs
  const micRecorder = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micResources = useRef<AudioCaptureResources | null>(null);
  const micChunks = useRef<Blob[]>([]);
  const micAnimationFrame = useRef<number | null>(null);

  // System audio recording refs
  const systemAudioRecorder = useRef<MediaRecorder | null>(null);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const systemAudioResources = useRef<AudioCaptureResources | null>(null);
  const systemAudioChunks = useRef<Blob[]>([]);
  const systemAudioAnimationFrame = useRef<number | null>(null);

  // Audio level update loops
  const updateMicAudioLevel = useRef(() => {
    if (!micResources.current?.analyser) return;
    setMicAudioLevel(getAudioLevel(micResources.current.analyser));
    micAnimationFrame.current = requestAnimationFrame(updateMicAudioLevel.current);
  });

  const updateSystemAudioLevel = useRef(() => {
    if (!systemAudioResources.current?.analyser) return;
    setSystemAudioLevel(getAudioLevel(systemAudioResources.current.analyser));
    systemAudioAnimationFrame.current = requestAnimationFrame(updateSystemAudioLevel.current);
  });

  const stopRecording = useRef(() => {
    if (mediaRecorder.current?.state === "recording") {
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
      }
      mediaRecorder.current.stop();
      setRecording(false);
      window.electronAPI?.setRecordingState(false);
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.electronAPI?.onStopRecordingFromTray) {
      cleanup = window.electronAPI.onStopRecordingFromTray(() => stopRecording.current());
    }

    return () => {
      cleanup?.();
      // Stop all recorders
      [mediaRecorder, cameraRecorder, micRecorder, systemAudioRecorder].forEach(ref => {
        if (ref.current?.state === "recording") ref.current.stop();
      });
      // Stop all streams
      [stream, cameraStreamRef, micStreamRef, systemAudioStreamRef].forEach(ref => {
        ref.current?.getTracks().forEach(track => track.stop());
        ref.current = null;
      });
      // Cancel animation frames
      [micAnimationFrame, systemAudioAnimationFrame].forEach(ref => {
        if (ref.current) cancelAnimationFrame(ref.current);
        ref.current = null;
      });
      // Cleanup audio resources
      cleanupAudioResources(micResources.current);
      cleanupAudioResources(systemAudioResources.current);
      micResources.current = null;
      systemAudioResources.current = null;
    };
  }, []);

  // Start camera capture
  const startCameraCapture = async (deviceId: string): Promise<MediaStream | null> => {
    if (!deviceId?.trim()) {
      console.warn('Invalid camera deviceId provided');
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: CAMERA_WIDTH },
          height: { ideal: CAMERA_HEIGHT },
          frameRate: { ideal: CAMERA_FRAME_RATE },
        },
        audio: false,
      });
    } catch (err) {
      console.warn('Camera capture failed:', err);
      return null;
    }
  };

  // Start microphone capture with level metering
  const startMicCapture = async (deviceId: string): Promise<MediaStream | null> => {
    if (!deviceId?.trim()) {
      console.warn('Invalid mic deviceId provided');
      return null;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Setup level metering with proper error handling
      try {
        micResources.current = setupAudioLevelMeter(audioStream);
        updateMicAudioLevel.current();
      } catch (audioErr) {
        console.warn('Failed to setup mic level meter:', audioErr);
        // Continue without level metering
      }
      return audioStream;
    } catch (err) {
      console.warn('Microphone capture failed:', err);
      return null;
    }
  };

  const startRecording = async () => {
    try {
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        alert("Please select a source to record");
        return;
      }

      // Start camera capture
      if (cameraDeviceId) {
        const camStream = await startCameraCapture(cameraDeviceId);
        if (camStream) {
          cameraStreamRef.current = camStream;
          setCameraStream(camStream);
          cameraChunks.current = [];
          const cameraMimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
          const camRecorder = new MediaRecorder(camStream, { mimeType: cameraMimeType, videoBitsPerSecond: CAMERA_BITRATE });
          camRecorder.ondataavailable = (e) => { if (e.data.size > 0) cameraChunks.current.push(e.data); };
          cameraRecorder.current = camRecorder;
          camRecorder.start(1000);
        }
      }

      // Start mic capture
      if (micDeviceId) {
        const audioStream = await startMicCapture(micDeviceId);
        if (audioStream) {
          micStreamRef.current = audioStream;
          setMicStream(audioStream);
          micChunks.current = [];
          const audioRecorder = new MediaRecorder(audioStream, { mimeType: selectAudioMimeType(), audioBitsPerSecond: AUDIO_BITRATE });
          audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.current.push(e.data); };
          micRecorder.current = audioRecorder;
          audioRecorder.start(1000);
        }
      }

      // Start system audio capture (macOS 13.2+ only)
      if (systemAudioEnabled) {
        const sysAudioStream = await captureSystemAudio(selectedSource.id);
        if (sysAudioStream) {
          systemAudioStreamRef.current = sysAudioStream;
          systemAudioChunks.current = [];
          // Setup level metering with proper error handling
          try {
            systemAudioResources.current = setupAudioLevelMeter(sysAudioStream);
            updateSystemAudioLevel.current();
          } catch (audioErr) {
            console.warn('Failed to setup system audio level meter:', audioErr);
          }
          const sysAudioRecorder = new MediaRecorder(sysAudioStream, {
            mimeType: selectAudioMimeType(),
            audioBitsPerSecond: SYSTEM_AUDIO_BITRATE,
          });
          sysAudioRecorder.ondataavailable = (e) => { if (e.data.size > 0) systemAudioChunks.current.push(e.data); };
          systemAudioRecorder.current = sysAudioRecorder;
          sysAudioRecorder.start(1000);
        }
      }

      // Start screen capture
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron requires non-standard constraints
      const mediaStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id,
            maxWidth: TARGET_WIDTH,
            maxHeight: TARGET_HEIGHT,
            maxFrameRate: TARGET_FRAME_RATE,
            minFrameRate: 30,
          },
        },
      });
      stream.current = mediaStream;

      if (!stream.current) {
        throw new Error("Media stream is not available.");
      }

      const videoTrack = stream.current.getVideoTracks()[0];
      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
          width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
          height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
        });
      } catch {
        console.warn("Unable to lock 4K/60fps constraints, using best available.");
      }

      const settings = videoTrack.getSettings();
      const frameRate = settings.frameRate ?? TARGET_FRAME_RATE;
      const width = Math.floor((settings.width ?? 1920) / 2) * 2;
      const height = Math.floor((settings.height ?? 1080) / 2) * 2;
      const videoBitsPerSecond = computeVideoBitrate(width, height);
      const mimeType = selectVideoMimeType();

      console.log(`Recording at ${width}x${height} @ ${frameRate}fps using ${mimeType} / ${Math.round(videoBitsPerSecond / 1_000_000)} Mbps`);

      chunks.current = [];
      const currentStream = stream.current; // Capture for closure
      const recorder = new MediaRecorder(currentStream, { mimeType, videoBitsPerSecond });
      mediaRecorder.current = recorder;
      recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.current.push(e.data); };

      recorder.onstop = async () => {
        stream.current = null;
        if (chunks.current.length === 0) return;

        const duration = Date.now() - startTime.current;
        const buggyBlob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];
        const timestamp = Date.now();

        try {
          const videoBlob = await fixWebmDuration(buggyBlob, duration);
          const arrayBuffer = await videoBlob.arrayBuffer();
          const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, `recording-${timestamp}.webm`);
          if (!videoResult.success) {
            console.error('Failed to store video:', videoResult.message);
            return;
          }

          // Store camera recording
          const cameraBlob = await stopMediaRecorderSafely(cameraRecorder.current, cameraChunks.current, 'video/webm');
          cameraChunks.current = [];
          if (cameraBlob?.size) {
            const cameraBuffer = await cameraBlob.arrayBuffer();
            await window.electronAPI.storeCameraRecording(cameraBuffer, `camera-${timestamp}.webm`);
          }

          // Store mic recording
          const micBlob = await stopMediaRecorderSafely(micRecorder.current, micChunks.current, selectAudioMimeType());
          micChunks.current = [];
          if (micBlob?.size) {
            const micBuffer = await micBlob.arrayBuffer();
            await window.electronAPI.storeAudioRecording(micBuffer, `mic-${timestamp}.webm`);
          }

          // Store system audio recording
          const sysAudioBlob = await stopMediaRecorderSafely(systemAudioRecorder.current, systemAudioChunks.current, selectAudioMimeType());
          systemAudioChunks.current = [];
          if (sysAudioBlob?.size) {
            const sysAudioBuffer = await sysAudioBlob.arrayBuffer();
            await window.electronAPI.storeSystemAudioRecording(sysAudioBuffer, `system-audio-${timestamp}.webm`);
          }

          // Cleanup camera
          if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(track => track.stop());
            cameraStreamRef.current = null;
            setCameraStream(null);
          }

          // Cleanup mic
          if (micAnimationFrame.current) {
            cancelAnimationFrame(micAnimationFrame.current);
            micAnimationFrame.current = null;
          }
          cleanupAudioResources(micResources.current);
          micResources.current = null;
          if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
            setMicStream(null);
          }
          setMicAudioLevel(0);

          // Cleanup system audio
          if (systemAudioAnimationFrame.current) {
            cancelAnimationFrame(systemAudioAnimationFrame.current);
            systemAudioAnimationFrame.current = null;
          }
          cleanupAudioResources(systemAudioResources.current);
          systemAudioResources.current = null;
          if (systemAudioStreamRef.current) {
            systemAudioStreamRef.current.getTracks().forEach(track => track.stop());
            systemAudioStreamRef.current = null;
          }
          setSystemAudioLevel(0);

          if (videoResult.path) {
            await window.electronAPI.setCurrentVideoPath(videoResult.path);
          }
          await window.electronAPI.switchToEditor();
        } catch (error) {
          console.error('Error saving recording:', error);
        }
      };

      recorder.onerror = () => setRecording(false);
      recorder.start(1000);
      startTime.current = Date.now();
      setRecording(true);
      window.electronAPI?.setRecordingState(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecording(false);
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
    }
  };

  const toggleRecording = () => {
    recording ? stopRecording.current() : startRecording();
  };

  return { recording, toggleRecording, cameraStream, micStream, micAudioLevel, systemAudioLevel };
}
