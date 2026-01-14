import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import {
  TARGET_FRAME_RATE,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  AUDIO_BITRATE,
  AUDIO_FFT_SIZE,
  CAMERA_BITRATE,
  CAMERA_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_FRAME_RATE,
  selectVideoMimeType,
  selectAudioMimeType,
  computeVideoBitrate,
  calculateAudioLevel,
} from "@/lib/recording-constants";

interface UseScreenRecorderOptions {
  cameraDeviceId?: string | null;
  micDeviceId?: string | null;
}

type UseScreenRecorderReturn = {
  recording: boolean;
  toggleRecording: () => void;
  cameraStream: MediaStream | null;
  micStream: MediaStream | null;
  micAudioLevel: number;
};

export function useScreenRecorder(options: UseScreenRecorderOptions = {}): UseScreenRecorderReturn {
  const { cameraDeviceId, micDeviceId } = options;

  const [recording, setRecording] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micAudioLevel, setMicAudioLevel] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const cameraRecorder = useRef<MediaRecorder | null>(null);
  const micRecorder = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContext = useRef<AudioContext | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const micAnimationFrame = useRef<number | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cameraChunks = useRef<Blob[]>([]);
  const micChunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);

  const stopCameraRecording = useRef(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!cameraRecorder.current || cameraRecorder.current.state !== 'recording') {
        resolve(null);
        return;
      }
      cameraRecorder.current.onstop = () => {
        const blob = new Blob(cameraChunks.current, { type: 'video/webm' });
        cameraChunks.current = [];
        resolve(blob);
      };
      cameraRecorder.current.stop();
    });
  });

  const stopMicRecording = useRef(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!micRecorder.current || micRecorder.current.state !== 'recording') {
        resolve(null);
        return;
      }
      micRecorder.current.onstop = () => {
        const blob = new Blob(micChunks.current, { type: selectAudioMimeType() });
        micChunks.current = [];
        resolve(blob);
      };
      micRecorder.current.stop();
    });
  });

  // Update mic audio level for VU meter at ~60fps
  const updateMicAudioLevel = useRef(() => {
    if (!micAnalyser.current) return;
    const dataArray = new Uint8Array(micAnalyser.current.fftSize);
    micAnalyser.current.getByteTimeDomainData(dataArray);
    setMicAudioLevel(calculateAudioLevel(dataArray));
    micAnimationFrame.current = requestAnimationFrame(updateMicAudioLevel.current);
  });

  const stopRecording = useRef(() => {
    if (mediaRecorder.current?.state === "recording") {
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
      }
      // NOTE: Don't stop cameraRecorder here! Let stopCameraRecording handle it
      // in the main recorder's onstop handler to ensure blob is captured properly
      mediaRecorder.current.stop();
      setRecording(false);

      window.electronAPI?.setRecordingState(false);
    }
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.electronAPI?.onStopRecordingFromTray) {
      cleanup = window.electronAPI.onStopRecordingFromTray(() => {
        stopRecording.current();
      });
    }

    return () => {
      if (cleanup) cleanup();

      if (mediaRecorder.current?.state === "recording") {
        mediaRecorder.current.stop();
      }
      if (cameraRecorder.current?.state === "recording") {
        cameraRecorder.current.stop();
      }
      if (micRecorder.current?.state === "recording") {
        micRecorder.current.stop();
      }
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
        stream.current = null;
      }
      // Clean up camera stream ref
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(track => track.stop());
        cameraStreamRef.current = null;
      }
      // Clean up mic stream and audio context
      if (micAnimationFrame.current) {
        cancelAnimationFrame(micAnimationFrame.current);
        micAnimationFrame.current = null;
      }
      if (micAudioContext.current) {
        micAudioContext.current.close();
        micAudioContext.current = null;
        micAnalyser.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
    };
  }, []);

  // Start camera capture if deviceId provided
  const startCameraCapture = async (deviceId: string): Promise<MediaStream | null> => {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
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
      console.warn('Camera capture failed, continuing without camera:', err);
      return null;
    }
  };

  // Start microphone capture with audio level metering
  const startMicCapture = async (deviceId: string): Promise<MediaStream | null> => {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      console.warn('Invalid mic deviceId provided');
      return null;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Setup Web Audio API for real-time level metering
      micAudioContext.current = new AudioContext();
      const source = micAudioContext.current.createMediaStreamSource(audioStream);
      micAnalyser.current = micAudioContext.current.createAnalyser();
      micAnalyser.current.fftSize = AUDIO_FFT_SIZE;
      source.connect(micAnalyser.current);
      updateMicAudioLevel.current();
      return audioStream;
    } catch (err) {
      console.warn('Microphone capture failed, continuing without mic:', err);
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

      // Start camera capture if deviceId provided
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

      // Start mic capture if deviceId provided
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
      } catch (error) {
        console.warn("Unable to lock 4K/60fps constraints, using best available track settings.", error);
      }

      const settings = videoTrack.getSettings();
      const frameRate = settings.frameRate ?? TARGET_FRAME_RATE;

      // Ensure dimensions are divisible by 2 for VP9/AV1 codec compatibility
      const width = Math.floor((settings.width ?? 1920) / 2) * 2;
      const height = Math.floor((settings.height ?? 1080) / 2) * 2;

      const videoBitsPerSecond = computeVideoBitrate(width, height);
      const mimeType = selectVideoMimeType();

      console.log(
        `Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType} / ${Math.round(
          videoBitsPerSecond / 1_000_000
        )} Mbps`
      );

      chunks.current = [];
      const recorder = new MediaRecorder(stream.current, {
        mimeType,
        videoBitsPerSecond,
      });
      mediaRecorder.current = recorder;
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.current = null;
        if (chunks.current.length === 0) return;
        const duration = Date.now() - startTime.current;
        const recordedChunks = chunks.current;
        const buggyBlob = new Blob(recordedChunks, { type: mimeType });
        chunks.current = [];
        const timestamp = Date.now();
        const videoFileName = `recording-${timestamp}.webm`;

        try {
          const videoBlob = await fixWebmDuration(buggyBlob, duration);
          const arrayBuffer = await videoBlob.arrayBuffer();
          const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName);
          if (!videoResult.success) {
            console.error('Failed to store video:', videoResult.message);
            return;
          }

          // Store camera recording if exists (use ref to avoid stale closure)
          const cameraBlob = await stopCameraRecording.current();
          if (cameraBlob && cameraBlob.size > 0) {
            const cameraFileName = `camera-${timestamp}.webm`;
            const cameraBuffer = await cameraBlob.arrayBuffer();
            const cameraResult = await window.electronAPI.storeCameraRecording(cameraBuffer, cameraFileName);
            if (!cameraResult.success) {
              console.warn('Failed to store camera recording:', cameraResult.error);
            }
          }

          // Store mic recording if exists
          const micBlob = await stopMicRecording.current();
          if (micBlob && micBlob.size > 0) {
            const micFileName = `mic-${timestamp}.webm`;
            const micBuffer = await micBlob.arrayBuffer();
            const micResult = await window.electronAPI.storeAudioRecording(micBuffer, micFileName);
            if (!micResult.success) {
              console.warn('Failed to store mic recording:', micResult.error);
            }
          }

          // Clean up camera stream using ref (avoids stale closure)
          if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(track => track.stop());
            cameraStreamRef.current = null;
            setCameraStream(null);
          }

          // Clean up mic stream and audio context
          if (micAnimationFrame.current) {
            cancelAnimationFrame(micAnimationFrame.current);
            micAnimationFrame.current = null;
          }
          if (micAudioContext.current) {
            micAudioContext.current.close();
            micAudioContext.current = null;
            micAnalyser.current = null;
          }
          if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
            setMicStream(null);
          }
          setMicAudioLevel(0);

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
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
        stream.current = null;
      }
    }
  };

  const toggleRecording = () => {
    recording ? stopRecording.current() : startRecording();
  };

  return { recording, toggleRecording, cameraStream, micStream, micAudioLevel };
}
