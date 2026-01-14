import { forwardRef, useImperativeHandle, useRef, useEffect, useState, useMemo } from 'react';
import type { CameraPipConfig, CameraPipShape } from './types';
import { CAMERA_PIP_SIZE_PRESETS } from './types';

// Margin from edge in pixels
const CAMERA_PIP_MARGIN = 16;

/**
 * Get CSS styles for camera PiP based on shape.
 * - rectangle: Original aspect, configurable borderRadius
 * - square: 1:1 aspect, configurable borderRadius
 * - circle: 1:1 aspect, 50% rounding (always full circle)
 */
function getShapeStyles(shape: CameraPipShape, borderRadius: number): {
  borderRadius: string;
  forceSquare: boolean;
} {
  switch (shape) {
    case 'rectangle':
      return { borderRadius: `${borderRadius}%`, forceSquare: false };
    case 'square':
      return { borderRadius: `${borderRadius}%`, forceSquare: true };
    case 'circle':
      return { borderRadius: '50%', forceSquare: true };
    default:
      return { borderRadius: `${borderRadius}%`, forceSquare: false };
  }
}

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
    const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);

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

    // Reset error state and aspect ratio when video path changes
    useEffect(() => {
      setHasError(false);
      setVideoAspectRatio(null);
    }, [videoPath]);

    // Get shape-dependent styles
    const shapeStyles = useMemo(
      () => getShapeStyles(config.shape || 'rectangle', config.borderRadius),
      [config.shape, config.borderRadius]
    );

    if (!config.enabled || hasError) return null;

    // Calculate size and position
    const sizePercent = CAMERA_PIP_SIZE_PRESETS[config.size];
    const baseSize = Math.round(containerWidth * (sizePercent / 100));

    // For rectangle: use original aspect ratio; for square/circle: use 1:1
    let pipWidth = baseSize;
    let pipHeight = baseSize;
    if (!shapeStyles.forceSquare && videoAspectRatio && videoAspectRatio !== 1) {
      // Rectangle shape: maintain original camera aspect ratio
      if (videoAspectRatio > 1) {
        // Landscape camera: width = baseSize, height = baseSize / aspectRatio
        pipWidth = baseSize;
        pipHeight = Math.round(baseSize / videoAspectRatio);
      } else {
        // Portrait camera: height = baseSize, width = baseSize * aspectRatio
        pipHeight = baseSize;
        pipWidth = Math.round(baseSize * videoAspectRatio);
      }
    }

    const positionStyles: Record<string, React.CSSProperties> = {
      'top-left': { top: CAMERA_PIP_MARGIN, left: CAMERA_PIP_MARGIN },
      'top-right': { top: CAMERA_PIP_MARGIN, right: CAMERA_PIP_MARGIN },
      'bottom-left': { bottom: CAMERA_PIP_MARGIN, left: CAMERA_PIP_MARGIN },
      'bottom-right': { bottom: CAMERA_PIP_MARGIN, right: CAMERA_PIP_MARGIN },
    };

    // Handle video metadata to get aspect ratio
    const handleLoadedMetadata = () => {
      const video = videoRef.current;
      if (video && video.videoWidth && video.videoHeight) {
        setVideoAspectRatio(video.videoWidth / video.videoHeight);
      }
    };

    return (
      <div
        className="absolute overflow-hidden shadow-2xl"
        style={{
          ...positionStyles[config.position],
          width: pipWidth,
          height: pipHeight,
          borderRadius: shapeStyles.borderRadius,
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
          onLoadedMetadata={handleLoadedMetadata}
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
