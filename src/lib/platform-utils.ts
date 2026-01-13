/**
 * Platform detection utilities for macOS-specific features.
 * System audio capture requires macOS 13.2+ (ScreenCaptureKit).
 */

interface MacOSVersion {
  major: number;
  minor: number;
}

/**
 * Parse macOS version from user agent or OS string.
 * Returns null if not macOS or version cannot be determined.
 */
export function getMacOSVersion(): MacOSVersion | null {
  if (typeof navigator === 'undefined') return null;

  // Parse from navigator.userAgent: "Mac OS X 14_2" or "Mac OS X 14.2"
  const match = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)/);
  if (match) {
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
    };
  }
  return null;
}

/**
 * Check if current platform supports system audio capture.
 * Requires macOS 13.2+ (Ventura) for ScreenCaptureKit audio.
 */
export function supportsSystemAudio(): boolean {
  const version = getMacOSVersion();
  if (!version) return false;

  // macOS 13.2+ required for ScreenCaptureKit system audio
  if (version.major > 13) return true;
  if (version.major === 13 && version.minor >= 2) return true;
  return false;
}

/**
 * Check if running on macOS.
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.includes('Mac OS X');
}

/**
 * Get platform name for display.
 */
export function getPlatformName(): 'macOS' | 'Windows' | 'Linux' | 'Unknown' {
  if (typeof navigator === 'undefined') return 'Unknown';

  const ua = navigator.userAgent;
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown';
}
