import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getMacOSVersion,
  supportsSystemAudio,
  isMacOS,
  getPlatformName,
} from './platform-utils';

describe('platform-utils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getMacOSVersion', () => {
    it('returns version for macOS user agent with underscore format', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36',
      });

      const version = getMacOSVersion();
      expect(version).toEqual({ major: 14, minor: 2, patch: 0, raw: 'Mac OS X 14_2' });
    });

    it('returns version for macOS user agent with dot format', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13.2) AppleWebKit/537.36',
      });

      const version = getMacOSVersion();
      expect(version).toEqual({ major: 13, minor: 2, patch: 0, raw: 'Mac OS X 13.2' });
    });

    it('returns null for Windows user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      expect(getMacOSVersion()).toBeNull();
    });

    it('returns null for Linux user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      });

      expect(getMacOSVersion()).toBeNull();
    });
  });

  describe('supportsSystemAudio', () => {
    it('returns true for macOS 14.x', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
      });

      expect(supportsSystemAudio()).toBe(true);
    });

    it('returns true for macOS 13.2', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_2) AppleWebKit/537.36',
      });

      expect(supportsSystemAudio()).toBe(true);
    });

    it('returns true for macOS 13.5', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36',
      });

      expect(supportsSystemAudio()).toBe(true);
    });

    it('returns false for macOS 13.1', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_1) AppleWebKit/537.36',
      });

      expect(supportsSystemAudio()).toBe(false);
    });

    it('returns false for macOS 12.x', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/537.36',
      });

      expect(supportsSystemAudio()).toBe(false);
    });

    it('returns false for Windows', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      expect(supportsSystemAudio()).toBe(false);
    });
  });

  describe('isMacOS', () => {
    it('returns true for macOS user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
      });

      expect(isMacOS()).toBe(true);
    });

    it('returns false for Windows user agent', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      expect(isMacOS()).toBe(false);
    });
  });

  describe('getPlatformName', () => {
    it('returns "macOS" for macOS', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
      });

      expect(getPlatformName()).toBe('macOS');
    });

    it('returns "Windows" for Windows', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      expect(getPlatformName()).toBe('Windows');
    });

    it('returns "Linux" for Linux', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      });

      expect(getPlatformName()).toBe('Linux');
    });
  });
});
