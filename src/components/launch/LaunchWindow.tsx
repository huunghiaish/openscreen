/**
 * HUD overlay launch window with recording controls and device selectors.
 * Floating controls for screen capture, camera, mic, and system audio.
 */
import { useState, useEffect } from 'react';
import styles from './LaunchWindow.module.css';
import { useScreenRecorder } from '@/hooks/useScreenRecorder';
import { useMediaDevices } from '@/hooks/use-media-devices';
import { useMicrophoneCapture } from '@/hooks/use-microphone-capture';
import { useCameraOverlay } from '@/hooks/use-camera-overlay';
import { useRecordingTimer } from '@/hooks/use-recording-timer';
import { useSelectedSource } from '@/hooks/use-selected-source';
import { Button } from '@/components/ui/button';
import { BsRecordCircle, BsEye, BsEyeSlash } from 'react-icons/bs';
import { FaRegStopCircle } from 'react-icons/fa';
import { MdMonitor } from 'react-icons/md';
import { RxDragHandleDots2 } from 'react-icons/rx';
import { FaFolderMinus } from 'react-icons/fa6';
import { FiMinus, FiX } from 'react-icons/fi';
import { ContentClamp } from '@/components/ui/content-clamp';
import { CameraSettingsDropdown } from './camera-settings-dropdown';
import { MicSettingsDropdown } from './mic-settings-dropdown';
import { SystemAudioToggle } from './system-audio-toggle';
import type { CameraPosition, CameraSize } from '@/types/media-devices';

export function LaunchWindow() {
  // Device management
  const {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    systemAudioEnabled,
    setSelectedCameraId,
    setSelectedMicId,
    setSystemAudioEnabled,
    requestPermissions,
    permissionStatus,
    systemAudioSupported,
  } = useMediaDevices();

  // Microphone capture for audio level metering
  const {
    audioLevel: micAudioLevel,
    startCapture: startMicCapture,
    stopCapture: stopMicCapture,
  } = useMicrophoneCapture();

  // Source selection
  const { sourceName, hasSelectedSource, openSourceSelector } = useSelectedSource();

  // Camera settings state (defaults from plan: bottom-right, medium)
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('bottom-right');
  const [cameraSize, setCameraSize] = useState<CameraSize>('medium');
  const [cameraPreviewEnabled, setCameraPreviewEnabled] = useState(true);

  const cameraEnabled = selectedCameraId !== null;

  // Screen recording
  const { recording, toggleRecording } = useScreenRecorder({
    cameraDeviceId: cameraEnabled ? selectedCameraId : null,
  });

  // Recording timer
  const { formattedTime } = useRecordingTimer(recording);

  // Camera overlay management
  useCameraOverlay({
    recording,
    cameraEnabled,
    cameraDeviceId: selectedCameraId,
    previewEnabled: cameraPreviewEnabled,
  });

  // Start/stop mic capture when mic selection changes
  useEffect(() => {
    if (selectedMicId) {
      startMicCapture(selectedMicId);
    } else {
      stopMicCapture();
    }
  }, [selectedMicId, startMicCapture, stopMicCapture]);

  // Handle camera selection with permission request
  const handleCameraSelect = async (deviceId: string | null) => {
    if (deviceId !== null && permissionStatus !== 'granted') {
      const granted = await requestPermissions();
      if (!granted) return;
    }
    setSelectedCameraId(deviceId);
    if (deviceId !== null) {
      setCameraPreviewEnabled(true);
    }
  };

  // Handle mic selection with permission request
  const handleMicSelect = async (deviceId: string | null) => {
    if (deviceId !== null && permissionStatus !== 'granted') {
      const granted = await requestPermissions();
      if (!granted) return;
    }
    setSelectedMicId(deviceId);
  };

  // Toggle camera preview
  const toggleCameraPreview = () => {
    if (!cameraEnabled) return;
    setCameraPreviewEnabled((prev) => !prev);
  };

  // Open video file
  const openVideoFile = async () => {
    if (!window.electronAPI?.openVideoFilePicker) return;
    const result = await window.electronAPI.openVideoFilePicker();
    if (result.cancelled || !result.success || !result.path) return;
    await window.electronAPI.setCurrentVideoPath?.(result.path);
    await window.electronAPI.switchToEditor?.();
  };

  // HUD window controls
  const sendHudOverlayHide = () => window.electronAPI?.hudOverlayHide?.();
  const sendHudOverlayClose = () => window.electronAPI?.hudOverlayClose?.();

  // System audio unsupported message
  const systemAudioUnsupportedMessage = systemAudioSupported
    ? null
    : 'Requires macOS 13.2+ for system audio capture';

  return (
    <div className="w-full h-full flex items-center bg-transparent">
      <div
        className={`w-full max-w-[560px] mx-auto flex items-center justify-between px-4 py-2 ${styles.electronDrag}`}
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
        {/* Drag handle */}
        <div className={`flex items-center gap-1 ${styles.electronDrag}`}>
          <RxDragHandleDots2 size={18} className="text-white/40" />
        </div>

        {/* Source selector */}
        <Button
          variant="link"
          size="sm"
          className={`gap-1 text-white bg-transparent hover:bg-transparent px-0 flex-1 text-left text-xs ${styles.electronNoDrag}`}
          onClick={openSourceSelector}
          disabled={recording}
          aria-label="Select screen or window to record"
        >
          <MdMonitor size={14} className="text-white" />
          <ContentClamp truncateLength={6}>{sourceName}</ContentClamp>
        </Button>

        <div className="w-px h-6 bg-white/30" aria-hidden="true" />

        {/* Record button */}
        <Button
          variant="link"
          size="sm"
          onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
          disabled={!hasSelectedSource && !recording}
          className={`gap-1 text-white bg-transparent hover:bg-transparent px-2 text-center text-xs ${styles.electronNoDrag}`}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
        >
          {recording ? (
            <>
              <FaRegStopCircle size={14} className="text-red-400" />
              <span className="text-red-400">{formattedTime}</span>
            </>
          ) : (
            <>
              <BsRecordCircle size={14} className={hasSelectedSource ? 'text-white' : 'text-white/50'} />
              <span className={hasSelectedSource ? 'text-white' : 'text-white/50'}>Record</span>
            </>
          )}
        </Button>

        <div className="w-px h-6 bg-white/30" aria-hidden="true" />

        {/* Device controls group */}
        <div className={`flex items-center gap-1 ${styles.electronNoDrag}`} role="group" aria-label="Device controls">
          {/* Camera dropdown */}
          <CameraSettingsDropdown
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onSelectCamera={handleCameraSelect}
            position={cameraPosition}
            onPositionChange={setCameraPosition}
            size={cameraSize}
            onSizeChange={setCameraSize}
            disabled={recording}
          />

          {/* Camera preview toggle */}
          <Button
            variant="link"
            size="icon"
            onClick={toggleCameraPreview}
            disabled={recording || !cameraEnabled}
            title={cameraPreviewEnabled ? 'Hide camera preview' : 'Show camera preview'}
            className="bg-transparent hover:bg-transparent px-1"
            style={{ opacity: cameraEnabled ? 1 : 0.5 }}
            aria-label={cameraPreviewEnabled ? 'Hide camera preview' : 'Show camera preview'}
            aria-pressed={cameraPreviewEnabled}
          >
            {cameraPreviewEnabled && cameraEnabled ? (
              <BsEye size={14} className="text-green-400" />
            ) : (
              <BsEyeSlash size={14} className="text-white/50" />
            )}
          </Button>

          {/* Mic dropdown */}
          <MicSettingsDropdown
            microphones={microphones}
            selectedMicId={selectedMicId}
            onSelectMic={handleMicSelect}
            audioLevel={micAudioLevel}
            disabled={recording}
          />

          {/* System audio toggle */}
          <SystemAudioToggle
            enabled={systemAudioEnabled}
            onToggle={() => setSystemAudioEnabled(!systemAudioEnabled)}
            supported={systemAudioSupported}
            unsupportedMessage={systemAudioUnsupportedMessage}
            disabled={recording}
          />
        </div>

        <div className="w-px h-6 bg-white/30" aria-hidden="true" />

        {/* Open video file button */}
        <Button
          variant="link"
          size="sm"
          onClick={openVideoFile}
          className={`gap-1 text-white bg-transparent hover:bg-transparent px-0 flex-1 text-right text-xs ${styles.electronNoDrag} ${styles.folderButton}`}
          disabled={recording}
          aria-label="Open video file"
        >
          <FaFolderMinus size={14} className="text-white" />
          <span className={styles.folderText}>Open</span>
        </Button>

        {/* Separator before hide/close buttons */}
        <div className="w-px h-6 bg-white/30 mx-2" aria-hidden="true" />

        {/* Hide HUD button */}
        <Button
          variant="link"
          size="icon"
          className={`ml-2 ${styles.electronNoDrag} hudOverlayButton`}
          title="Hide HUD"
          onClick={sendHudOverlayHide}
          aria-label="Hide HUD overlay"
        >
          <FiMinus size={18} style={{ color: '#fff', opacity: 0.7 }} />
        </Button>

        {/* Close app button */}
        <Button
          variant="link"
          size="icon"
          className={`ml-1 ${styles.electronNoDrag} hudOverlayButton`}
          title="Close App"
          onClick={sendHudOverlayClose}
          aria-label="Close application"
        >
          <FiX size={18} style={{ color: '#fff', opacity: 0.7 }} />
        </Button>
      </div>
    </div>
  );
}
