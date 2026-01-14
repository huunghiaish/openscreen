/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  electronAPI: {
    getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>
    switchToEditor: () => Promise<void>
    openSourceSelector: () => Promise<void>
    selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>
    getSelectedSource: () => Promise<ProcessedDesktopSource | null>
    storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string }>
    getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>
    setRecordingState: (recording: boolean) => Promise<void>
    onStopRecordingFromTray: (callback: () => void) => () => void
    openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
    saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }>
    openVideoFilePicker: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    getPlatform: () => Promise<string>
    hudOverlayHide: () => void;
    hudOverlayClose: () => void;
    storeCameraRecording: (videoData: ArrayBuffer, fileName: string) => Promise<{
      success: boolean
      path?: string
      error?: string
    }>
    storeAudioRecording: (audioData: ArrayBuffer, fileName: string) => Promise<{
      success: boolean
      path?: string
      error?: string
    }>
    storeSystemAudioRecording: (audioData: ArrayBuffer, fileName: string) => Promise<{
      success: boolean
      path?: string
      error?: string
    }>
    getCameraVideoPath: (mainVideoPath: string) => Promise<{
      success: boolean
      path?: string | null
      error?: string
    }>
    showCameraOverlay: (deviceId: string) => Promise<void>
    hideCameraOverlay: () => Promise<void>
    getAssetBasePath: () => Promise<string | null>
  }
}

interface ProcessedDesktopSource {
  id: string
  name: string
  display_id: string
  thumbnail: string | null
  appIcon: string | null
}
