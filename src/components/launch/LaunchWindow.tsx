import { useState, useEffect, useRef } from "react";
import styles from "./LaunchWindow.module.css";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useMediaDevices } from "../../hooks/use-media-devices";
import { Button } from "../ui/button";
import { BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { MdMonitor } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { FaFolderMinus } from "react-icons/fa6";
import { FiMinus, FiX } from "react-icons/fi";
import { BsCameraVideo, BsCameraVideoOff, BsEye, BsEyeSlash } from "react-icons/bs";
import { ContentClamp } from "../ui/content-clamp";

export function LaunchWindow() {
  const {
    cameras,
    selectedCameraId,
    setSelectedCameraId,
    requestPermissions,
    permissionStatus,
  } = useMediaDevices();

  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraPreviewEnabled, setCameraPreviewEnabled] = useState(true);
  const activeCameraId = cameraEnabled ? selectedCameraId : null;
  const prevRecordingRef = useRef(false);

  const { recording, toggleRecording } = useScreenRecorder({
    cameraDeviceId: activeCameraId,
  });

  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Show/hide camera overlay window based on recording or preview state
  useEffect(() => {
    const wasRecording = prevRecordingRef.current;
    prevRecordingRef.current = recording;

    const api = window.electronAPI as typeof window.electronAPI & {
      showCameraOverlay?: (deviceId: string) => Promise<void>;
      hideCameraOverlay?: () => Promise<void>;
    };

    if (recording && !wasRecording && cameraEnabled && activeCameraId && cameraPreviewEnabled) {
      // Recording just started with camera enabled and preview on - show overlay
      api.showCameraOverlay?.(activeCameraId);
    } else if (!recording && wasRecording) {
      // Recording just stopped - always hide overlay
      api.hideCameraOverlay?.();
    }
  }, [recording, cameraEnabled, activeCameraId, cameraPreviewEnabled]);

  // Show/hide camera overlay when preview mode changes (only when not recording)
  const prevCameraPreviewRef = useRef(cameraPreviewEnabled);
  useEffect(() => {
    const wasPreviewEnabled = prevCameraPreviewRef.current;
    prevCameraPreviewRef.current = cameraPreviewEnabled;

    // Only respond to preview toggle changes, not recording state changes
    if (wasPreviewEnabled === cameraPreviewEnabled) return;
    if (recording) return;

    const api = window.electronAPI as typeof window.electronAPI & {
      showCameraOverlay?: (deviceId: string) => Promise<void>;
      hideCameraOverlay?: () => Promise<void>;
    };

    if (cameraPreviewEnabled && cameraEnabled && activeCameraId) {
      api.showCameraOverlay?.(activeCameraId);
    } else if (!cameraPreviewEnabled) {
      api.hideCameraOverlay?.();
    }
  }, [cameraPreviewEnabled, cameraEnabled, activeCameraId, recording]);

  // Show camera overlay when camera is first enabled with preview ON
  const prevCameraEnabledRef = useRef(cameraEnabled);
  useEffect(() => {
    const wasCameraEnabled = prevCameraEnabledRef.current;
    prevCameraEnabledRef.current = cameraEnabled;

    // Only respond to camera enable, not disable
    if (wasCameraEnabled || !cameraEnabled) return;
    if (recording) return;

    const api = window.electronAPI as typeof window.electronAPI & {
      showCameraOverlay?: (deviceId: string) => Promise<void>;
      hideCameraOverlay?: () => Promise<void>;
    };

    if (cameraPreviewEnabled && activeCameraId) {
      api.showCameraOverlay?.(activeCameraId);
    }
  }, [cameraEnabled, cameraPreviewEnabled, activeCameraId, recording]);

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
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStart]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const [selectedSource, setSelectedSource] = useState("Screen");
  const [hasSelectedSource, setHasSelectedSource] = useState(false);

  useEffect(() => {
    const checkSelectedSource = async () => {
      if (window.electronAPI) {
        const source = await window.electronAPI.getSelectedSource();
        if (source) {
          setSelectedSource(source.name);
          setHasSelectedSource(true);
        } else {
          setSelectedSource("Screen");
          setHasSelectedSource(false);
        }
      }
    };

    checkSelectedSource();
    
    const interval = setInterval(checkSelectedSource, 500);
    return () => clearInterval(interval);
  }, []);

  const openSourceSelector = () => {
    if (window.electronAPI) {
      window.electronAPI.openSourceSelector();
    }
  };

  const openVideoFile = async () => {
    const result = await window.electronAPI.openVideoFilePicker();
    
    if (result.cancelled) {
      return;
    }
    
    if (result.success && result.path) {
      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    }
  };

  // IPC events for hide/close
  const sendHudOverlayHide = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayHide) {
      window.electronAPI.hudOverlayHide();
    }
  };
  const sendHudOverlayClose = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayClose) {
      window.electronAPI.hudOverlayClose();
    }
  };

  // Toggle camera on/off
  const toggleCamera = async () => {
    if (!cameraEnabled) {
      // Enable camera
      if (permissionStatus !== 'granted') {
        const granted = await requestPermissions();
        if (!granted) return;
      }
      // Auto-select first camera if none selected
      if (!selectedCameraId && cameras.length > 0) {
        setSelectedCameraId(cameras[0].deviceId);
      }
      setCameraEnabled(true);
      setCameraPreviewEnabled(true); // Enable preview when camera is enabled
    } else {
      setCameraEnabled(false);
      setCameraPreviewEnabled(false); // Disable preview when camera is disabled
    }
  };

  // Toggle camera preview on/off
  const toggleCameraPreview = () => {
    if (!cameraEnabled) return;
    setCameraPreviewEnabled(!cameraPreviewEnabled);
  };

  return (
    <div className="w-full h-full flex items-center bg-transparent">
      <div
        className={`w-full max-w-[500px] mx-auto flex items-center justify-between px-4 py-2 ${styles.electronDrag}`}
        style={{
          borderRadius: 16,
          background: 'linear-gradient(135deg, rgba(30,30,40,0.92) 0%, rgba(20,20,30,0.85) 100%)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          boxShadow: '0 4px 24px 0 rgba(0,0,0,0.28), 0 1px 3px 0 rgba(0,0,0,0.14) inset',
          border: '1px solid rgba(80,80,120,0.22)',
          minHeight: 44,
        }}
      >
        <div className={`flex items-center gap-1 ${styles.electronDrag}`}> <RxDragHandleDots2 size={18} className="text-white/40" /> </div>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 text-white bg-transparent hover:bg-transparent px-0 flex-1 text-left text-xs ${styles.electronNoDrag}`}
          onClick={openSourceSelector}
          disabled={recording}
        >
          <MdMonitor size={14} className="text-white" />
          <ContentClamp truncateLength={6}>{selectedSource}</ContentClamp>
        </Button>

        <div className="w-px h-6 bg-white/30" />

        {/* Camera toggle button */}
        <Button
          variant="link"
          size="sm"
          onClick={toggleCamera}
          disabled={recording}
          title={cameraEnabled ? "Disable camera" : "Enable camera"}
          className={`gap-1 bg-transparent hover:bg-transparent px-2 text-xs ${styles.electronNoDrag}`}
        >
          {cameraEnabled ? (
            <BsCameraVideo size={14} className="text-green-400" />
          ) : (
            <BsCameraVideoOff size={14} className="text-white/50" />
          )}
          <span className={cameraEnabled ? "text-green-400" : "text-white/50"}>Camera</span>
        </Button>

        {/* Camera preview toggle button */}
        <Button
          variant="link"
          size="icon"
          onClick={toggleCameraPreview}
          disabled={recording || !cameraEnabled}
          title={cameraPreviewEnabled ? "Hide camera preview" : "Show camera preview"}
          className={`bg-transparent hover:bg-transparent px-1 ${styles.electronNoDrag}`}
        >
          {cameraPreviewEnabled ? (
            <BsEye size={14} className="text-green-400" />
          ) : (
            <BsEyeSlash size={14} className={cameraEnabled ? "text-white/70" : "text-white/30"} />
          )}
        </Button>

        <div className="w-px h-6 bg-white/30" />

        <Button
          variant="link"
          size="sm"
          onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
          disabled={!hasSelectedSource && !recording}
          className={`gap-1 text-white bg-transparent hover:bg-transparent px-0 flex-1 text-center text-xs ${styles.electronNoDrag}`}
        >
          {recording ? (
            <>
              <FaRegStopCircle size={14} className="text-red-400" />
              <span className="text-red-400">{formatTime(elapsed)}</span>
            </>
          ) : (
            <>
              <BsRecordCircle size={14} className={hasSelectedSource ? "text-white" : "text-white/50"} />
              <span className={hasSelectedSource ? "text-white" : "text-white/50"}>Record</span>
            </>
          )}
        </Button>
        

        <div className="w-px h-6 bg-white/30" />


        <Button
          variant="link"
          size="sm"
          onClick={openVideoFile}
          className={`gap-1 text-white bg-transparent hover:bg-transparent px-0 flex-1 text-right text-xs ${styles.electronNoDrag} ${styles.folderButton}`}
          disabled={recording}
        >
          <FaFolderMinus size={14} className="text-white" />
          <span className={styles.folderText}>Open</span>
        </Button>

         {/* Separator before hide/close buttons */}
        <div className="w-px h-6 bg-white/30 mx-2" />
        <Button
          variant="link"
          size="icon"
          className={`ml-2 ${styles.electronNoDrag} hudOverlayButton`}
          title="Hide HUD"
          onClick={sendHudOverlayHide}
        >
          <FiMinus size={18} style={{ color: '#fff', opacity: 0.7 }} />
          
        </Button>

        <Button
          variant="link"
          size="icon"
          className={`ml-1 ${styles.electronNoDrag} hudOverlayButton`}
          title="Close App"
          onClick={sendHudOverlayClose}
        >
          <FiX size={18} style={{ color: '#fff', opacity: 0.7 }} />
        </Button>
      </div>
    </div>
  );
}
