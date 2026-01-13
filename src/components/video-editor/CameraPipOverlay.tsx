import { forwardRef, useImperativeHandle, useRef, useEffect, useState } from 'react';
import type { CameraPipConfig } from './types';
import { CAMERA_PIP_SIZE_PRESETS } from './types';

// Margin from edge in pixels
const CAMERA_PIP_MARGIN = 16;

interface CameraPipOverlayProps {
  videoPath: string;
  config: CameraPipConfig;
  containerWidth: number;
  mainVideoRef: React.RefObject<HTMLVideoElement | null>;
  onError?: (error: string) => void;
}

export interface CameraPipOverlayRef {
  video: HTMLVideoElement | null;
  sync: () => void;
}

export const CameraPipOverlay = forwardRef<CameraPipOverlayRef, CameraPipOverlayProps>(
  ({ videoPath, config, containerWidth, mainVideoRef, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [hasError, setHasError] = useState(false);

    useImperativeHandle(ref, () => ({
      video: videoRef.current,
      sync: () => {
        const camera = videoRef.current;
        const main = mainVideoRef.current;
        if (!camera || !main) return;

        camera.currentTime = main.currentTime;
        if (!main.paused) {
          camera.play().catch(() => {});
        } else {
          camera.pause();
        }
      },
    }));

    // Sync camera with main video
    useEffect(() => {
      const camera = videoRef.current;
      const main = mainVideoRef.current;
      if (!camera || !main) return;

      const syncTime = () => {
        if (Math.abs(camera.currentTime - main.currentTime) > 0.1) {
          camera.currentTime = main.currentTime;
        }
      };

      const handlePlay = () => camera.play().catch(() => {});
      const handlePause = () => camera.pause();
      const handleSeeked = () => { camera.currentTime = main.currentTime; };

      main.addEventListener('play', handlePlay);
      main.addEventListener('pause', handlePause);
      main.addEventListener('seeked', handleSeeked);
      main.addEventListener('timeupdate', syncTime);

      return () => {
        main.removeEventListener('play', handlePlay);
        main.removeEventListener('pause', handlePause);
        main.removeEventListener('seeked', handleSeeked);
        main.removeEventListener('timeupdate', syncTime);
      };
    }, [mainVideoRef]);

    // Reset error state when video path changes
    useEffect(() => {
      setHasError(false);
    }, [videoPath]);

    if (!config.enabled || hasError) return null;

    // Calculate size and position
    const sizePercent = CAMERA_PIP_SIZE_PRESETS[config.size];
    const size = Math.round(containerWidth * (sizePercent / 100));

    const positionStyles: Record<string, React.CSSProperties> = {
      'top-left': { top: CAMERA_PIP_MARGIN, left: CAMERA_PIP_MARGIN },
      'top-right': { top: CAMERA_PIP_MARGIN, right: CAMERA_PIP_MARGIN },
      'bottom-left': { bottom: CAMERA_PIP_MARGIN, left: CAMERA_PIP_MARGIN },
      'bottom-right': { bottom: CAMERA_PIP_MARGIN, right: CAMERA_PIP_MARGIN },
    };

    return (
      <div
        className="absolute overflow-hidden shadow-2xl"
        style={{
          ...positionStyles[config.position],
          width: size,
          height: size,
          borderRadius: `${config.borderRadius}%`,
          border: '3px solid rgba(255,255,255,0.2)',
          zIndex: 100,
        }}
      >
        <video
          ref={videoRef}
          src={videoPath}
          muted
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }} // Mirror for natural look
          onError={() => {
            setHasError(true);
            onError?.('Failed to load camera video');
          }}
        />
      </div>
    );
  }
);

CameraPipOverlay.displayName = 'CameraPipOverlay';
