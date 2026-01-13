/**
 * Camera preview overlay component for displaying live webcam feed during recording.
 * Positioned in corners with configurable size and rounded corners styling.
 */

import { useRef, useEffect } from 'react';
import type { CameraPosition, CameraSize } from '@/types/media-devices';
import { CAMERA_SIZE_PIXELS } from '@/types/media-devices';

interface CameraPreviewOverlayProps {
  stream: MediaStream | null;
  position: CameraPosition;
  size: CameraSize;
  visible: boolean;
}

const POSITION_STYLES: Record<CameraPosition, React.CSSProperties> = {
  'top-left': { top: 24, left: 24 },
  'top-right': { top: 24, right: 24 },
  'bottom-left': { bottom: 24, left: 24 },
  'bottom-right': { bottom: 24, right: 24 },
};

export function CameraPreviewOverlay({
  stream,
  position,
  size,
  visible,
}: CameraPreviewOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!visible || !stream) return null;

  const dimensions = CAMERA_SIZE_PIXELS[size];
  const positionStyle = POSITION_STYLES[position];

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
        zIndex: 9999,
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
