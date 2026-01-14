/**
 * Platform detection utilities for macOS-specific features.
 * System audio capture requires macOS 13.2+ (ScreenCaptureKit).
 */

export interface MacOSVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/**
 * Parse macOS version from user agent or OS string.
 * Returns null if not macOS or version cannot be determined.
 */
export function getMacOSVersion(): MacOSVersion | null {
  if (typeof navigator === 'undefined') return null;

  // Parse from navigator.userAgent: "Mac OS X 14_2_1" or "Mac OS X 14.2.1"
  const match = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)(?:[._](\d+))?/);
  if (match) {
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3] || '0', 10),
      raw: match[0],
    };
  }
  return null;
}

/**
 * Check if current platform supports system audio capture.
 * Requires macOS 13.2+ (Ventura) for ScreenCaptureKit audio.
 * In Electron, assume macOS supports it if version detection fails (modern macOS).
 */
export function supportsSystemAudio(): boolean {
  // If running in Electron on macOS, assume supported (most users have modern macOS)
  if (isMacOS()) {
    const version = getMacOSVersion();
    // If version can't be determined in Electron, assume modern macOS
    if (!version) return true;
    // macOS 13.2+ required for ScreenCaptureKit system audio
    if (version.major > 13) return true;
    if (version.major === 13 && version.minor >= 2) return true;
    return false;
  }
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

/**
 * Get a user-friendly message explaining why system audio is unsupported.
 * Returns null if system audio IS supported on this platform.
 */
export function getSystemAudioSupportMessage(): string | null {
  const version = getMacOSVersion();
  if (!version) {
    return 'System audio capture is only available on macOS.';
  }
  if (version.major < 13 || (version.major === 13 && version.minor < 2)) {
    return `System audio requires macOS 13.2+. You have ${version.major}.${version.minor}.`;
  }
  return null;
}
