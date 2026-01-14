/**
 * Recording configuration constants and helper functions.
 * Centralized settings for video/audio bitrates, resolutions, codecs.
 */

// Target visually lossless 4K @ 60fps
export const TARGET_FRAME_RATE = 60;
export const TARGET_WIDTH = 3840;
export const TARGET_HEIGHT = 2160;
export const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;

// Audio recording settings
export const AUDIO_BITRATE = 128_000; // 128 kbps Opus
export const AUDIO_FFT_SIZE = 256; // For level metering
export const AUDIO_LEVEL_SCALE = 300; // RMS to 0-100 scale factor

// Camera recording settings
export const CAMERA_BITRATE = 2_500_000; // 2.5 Mbps
export const CAMERA_WIDTH = 1280;
export const CAMERA_HEIGHT = 720;
export const CAMERA_FRAME_RATE = 30;

/**
 * Select best available video codec for screen recording.
 * Priority: AV1 > H264 > VP9 > VP8 > fallback.
 */
export function selectVideoMimeType(): string {
  const preferred = [
    'video/webm;codecs=av1',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  return preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
}

/**
 * Select best audio codec (prefer Opus for efficiency).
 */
export function selectAudioMimeType(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
}

/**
 * Compute video bitrate based on resolution.
 * Higher resolutions get higher bitrates for quality.
 */
export function computeVideoBitrate(width: number, height: number): number {
  const pixels = width * height;
  const highFrameRateBoost = TARGET_FRAME_RATE >= 60 ? 1.7 : 1;

  if (pixels >= FOUR_K_PIXELS) {
    return Math.round(45_000_000 * highFrameRateBoost);
  }

  if (pixels >= 2560 * 1440) {
    return Math.round(28_000_000 * highFrameRateBoost);
  }

  return Math.round(18_000_000 * highFrameRateBoost);
}

/**
 * Calculate RMS audio level from time-domain data.
 * Returns value 0-100 for VU meter display.
 */
export function calculateAudioLevel(dataArray: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const normalized = (dataArray[i] - 128) / 128;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / dataArray.length);
  return Math.min(100, Math.round(rms * AUDIO_LEVEL_SCALE));
}
