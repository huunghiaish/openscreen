/**
 * Shared audio capture utilities for microphone and system audio.
 * Provides common functions for audio stream setup, level metering, and cleanup.
 */
import { supportsSystemAudio } from '@/lib/platform-utils';
import { AUDIO_FFT_SIZE, calculateAudioLevel } from '@/lib/recording-constants';

/** System audio bitrate: 192 kbps for higher quality desktop audio */
export const SYSTEM_AUDIO_BITRATE = 192_000;

export interface AudioCaptureResources {
  stream: MediaStream;
  audioContext: AudioContext;
  analyser: AnalyserNode;
}

/**
 * Setup audio level metering for a media stream.
 * Returns resources that must be cleaned up when done.
 */
export function setupAudioLevelMeter(
  stream: MediaStream
): AudioCaptureResources {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = AUDIO_FFT_SIZE;
  source.connect(analyser);

  return { stream, audioContext, analyser };
}

/**
 * Cleanup audio capture resources to prevent memory leaks.
 */
export function cleanupAudioResources(resources: AudioCaptureResources | null): void {
  if (!resources) return;

  try {
    resources.audioContext.close();
  } catch {
    // Ignore close errors
  }

  try {
    resources.stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Ignore stop errors
  }
}

/**
 * Create an audio level update callback for animation frame loop.
 * Returns current level (0-100) from analyser.
 */
export function getAudioLevel(analyser: AnalyserNode): number {
  const dataArray = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(dataArray);
  return calculateAudioLevel(dataArray);
}

/**
 * Capture system audio from screen source (macOS 13.2+ only).
 * Extracts audio track from ScreenCaptureKit desktop capture.
 * Returns audio-only stream or null if unsupported/failed.
 */
export async function captureSystemAudio(
  screenSourceId: string
): Promise<MediaStream | null> {
  if (!screenSourceId || typeof screenSourceId !== 'string') {
    console.warn('Invalid screenSourceId provided');
    return null;
  }

  if (!supportsSystemAudio()) {
    console.warn('System audio not supported on this platform');
    return null;
  }

  let dummyMediaStream: MediaStream | null = null;

  try {
    // Request desktop capture WITH audio flag (macOS 13.2+ ScreenCaptureKit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dummyMediaStream = await (navigator.mediaDevices as any).getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSourceId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSourceId,
          // Minimal video to satisfy API (we only need audio)
          maxWidth: 1,
          maxHeight: 1,
        },
      },
    });

    // Extract audio track from the combined stream
    const audioTracks = dummyMediaStream?.getAudioTracks() ?? [];
    if (audioTracks.length === 0) {
      console.warn('No system audio track available');
      return null;
    }

    // Create audio-only stream
    const audioOnlyStream = new MediaStream(audioTracks);

    // Stop the dummy video track we don't need
    dummyMediaStream?.getVideoTracks().forEach((t) => t.stop());

    return audioOnlyStream;
  } catch (err) {
    console.warn('System audio capture failed:', err);
    return null;
  } finally {
    // Ensure video tracks are cleaned up even on error
    dummyMediaStream?.getVideoTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // Ignore
      }
    });
  }
}

/**
 * Stop MediaRecorder and return blob with timeout protection.
 * Prevents promise hang from race conditions.
 */
export function stopMediaRecorderSafely(
  recorder: MediaRecorder | null,
  chunks: Blob[],
  mimeType: string,
  timeoutMs = 5000
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!recorder || recorder.state !== 'recording') {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      console.warn('MediaRecorder stop timeout, resolving with current chunks');
      const blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
      resolve(blob);
    }, timeoutMs);

    // Set handler BEFORE stopping to prevent race condition
    recorder.onstop = () => {
      clearTimeout(timeout);
      const blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
      resolve(blob);
    };

    try {
      recorder.stop();
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}
