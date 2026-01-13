/**
 * Hook for media device enumeration and selection.
 * Provides camera/mic lists, selection state, and permission handling.
 * Persists device selection to localStorage for better UX.
 */
import { useState, useEffect, useCallback } from 'react';
import type { UseMediaDevicesReturn, PermissionStatus } from '@/types/media-devices';
import { DEVICE_STORAGE_KEYS } from '@/types/media-devices';
import { supportsSystemAudio } from '@/lib/platform-utils';

/**
 * Load persisted value from localStorage.
 */
function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Save value to localStorage.
 */
function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function useMediaDevices(): UseMediaDevicesReturn {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraIdState] = useState<string | null>(() =>
    loadFromStorage(DEVICE_STORAGE_KEYS.SELECTED_CAMERA, null)
  );
  const [selectedMicId, setSelectedMicIdState] = useState<string | null>(() =>
    loadFromStorage(DEVICE_STORAGE_KEYS.SELECTED_MIC, null)
  );
  const [systemAudioEnabled, setSystemAudioEnabledState] = useState(() =>
    loadFromStorage(DEVICE_STORAGE_KEYS.SYSTEM_AUDIO_ENABLED, false)
  );
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
  const [isLoading, setIsLoading] = useState(true);
  const [systemAudioSupported] = useState(() => supportsSystemAudio());
  const [error, setError] = useState<string | null>(null);

  // Persist selection to localStorage with validation
  const setSelectedCameraId = useCallback(
    (id: string | null) => {
      // Allow null (deselect) or validate device exists
      if (id !== null && cameras.length > 0 && !cameras.some((d) => d.deviceId === id)) {
        console.warn(`Camera device ${id} not found in available devices`);
        return;
      }
      setSelectedCameraIdState(id);
      saveToStorage(DEVICE_STORAGE_KEYS.SELECTED_CAMERA, id);
    },
    [cameras]
  );

  const setSelectedMicId = useCallback(
    (id: string | null) => {
      // Allow null (deselect) or validate device exists
      if (id !== null && microphones.length > 0 && !microphones.some((d) => d.deviceId === id)) {
        console.warn(`Microphone device ${id} not found in available devices`);
        return;
      }
      setSelectedMicIdState(id);
      saveToStorage(DEVICE_STORAGE_KEYS.SELECTED_MIC, id);
    },
    [microphones]
  );

  const setSystemAudioEnabled = useCallback((enabled: boolean) => {
    setSystemAudioEnabledState(enabled);
    saveToStorage(DEVICE_STORAGE_KEYS.SYSTEM_AUDIO_ENABLED, enabled);
  }, []);

  const enumerateDevices = useCallback(async () => {
    try {
      setError(null);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');

      setCameras(videoInputs);
      setMicrophones(audioInputs);

      // Check if labels visible (indicates permission granted)
      const hasLabels = devices.some((d) => d.label && d.label.length > 0);
      setPermissionStatus(hasLabels ? 'granted' : 'prompt');

      // Validate persisted selections still exist (clear if device unplugged)
      if (selectedCameraId && !videoInputs.some((d) => d.deviceId === selectedCameraId)) {
        setSelectedCameraIdState(null);
        saveToStorage(DEVICE_STORAGE_KEYS.SELECTED_CAMERA, null);
      }
      if (selectedMicId && !audioInputs.some((d) => d.deviceId === selectedMicId)) {
        setSelectedMicIdState(null);
        saveToStorage(DEVICE_STORAGE_KEYS.SELECTED_MIC, null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enumerate devices';
      console.error('Failed to enumerate devices:', err);
      setError(message);
    }
  }, [selectedCameraId, selectedMicId]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      // Request both camera and mic permissions
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      // Stop tracks immediately - we only needed permission
      stream.getTracks().forEach((track) => track.stop());
      setPermissionStatus('granted');
      await enumerateDevices();
      return true;
    } catch (error) {
      console.error('Permission denied:', error);
      setPermissionStatus('denied');
      return false;
    }
  }, [enumerateDevices]);

  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    await enumerateDevices();
    setIsLoading(false);
  }, [enumerateDevices]);

  // Initial enumeration
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Listen for device changes (plug/unplug)
  useEffect(() => {
    const handleDeviceChange = () => {
      enumerateDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [enumerateDevices]);

  return {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    systemAudioEnabled,
    setSelectedCameraId,
    setSelectedMicId,
    setSystemAudioEnabled,
    refreshDevices,
    requestPermissions,
    permissionStatus,
    isLoading,
    systemAudioSupported,
    error,
  };
}
