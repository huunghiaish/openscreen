/**
 * Camera overlay window component for standalone camera preview during recording.
 * This component runs in a separate Electron window with transparent background.
 * Receives camera stream data via IPC from the main recording window.
 */

import { useEffect, useRef, useState } from 'react';
import type { CameraPosition, CameraSize } from '@/types/media-devices';
import { CAMERA_SIZE_PIXELS } from '@/types/media-devices';

const POSITION_STYLES: Record<CameraPosition, React.CSSProperties> = {
  'top-left': { top: 0, left: 0 },
  'top-right': { top: 0, right: 0 },
  'bottom-left': { bottom: 0, left: 0 },
  'bottom-right': { bottom: 0, right: 0 },
};

export function CameraOverlayWindow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [position] = useState<CameraPosition>('bottom-right');
  const [size] = useState<CameraSize>('medium');

  // Set transparent background for camera overlay window
  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    document.getElementById('root')?.style.setProperty('background', 'transparent');
  }, []);

  // Attach stream to video element when available
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  // Expose method for main window to set the stream
  useEffect(() => {
    // This window receives camera device ID from IPC and captures directly
    const handleCameraStart = async (deviceId: string) => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        setStream(mediaStream);
      } catch (err) {
        console.error('Camera overlay capture failed:', err);
      }
    };

    // Expose to window for IPC communication
    (window as unknown as { startCameraPreview: (deviceId: string) => Promise<void> }).startCameraPreview = handleCameraStart;

    return () => {
      delete (window as unknown as { startCameraPreview?: (deviceId: string) => Promise<void> }).startCameraPreview;
    };
  }, []);

  const dimensions = CAMERA_SIZE_PIXELS[size];
  const positionStyle = POSITION_STYLES[position];

  if (!stream) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: 'transparent',
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyle,
        width: dimensions.width,
        height: dimensions.height,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        border: '2px solid rgba(255,255,255,0.2)',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)', // Mirror for natural feel
        }}
      />
    </div>
  );
}
