import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog } from 'electron'

import fs from 'node:fs/promises'
import path from 'node:path'
import { RECORDINGS_DIR } from '../main'

interface DesktopSource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: string | null;
  appIcon: string | null;
}

let selectedSource: DesktopSource | null = null

// Max file sizes: 5GB video, 500MB camera, 100MB audio, 100MB system audio
const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024;
const MAX_CAMERA_SIZE = 500 * 1024 * 1024;
const MAX_AUDIO_SIZE = 100 * 1024 * 1024;
const MAX_SYSTEM_AUDIO_SIZE = 100 * 1024 * 1024;

/**
 * Validate and sanitize recording filename to prevent path traversal.
 * Enforces strict format: (recording|camera|mic)-{timestamp}.{extension}
 */
function validateRecordingFileName(fileName: string, allowedExtensions: string[]): string | null {
  // Extract basename to prevent directory traversal
  const baseName = path.basename(fileName);

  // Strict pattern: prefix-timestamp.extension (timestamp is 13-digit Unix ms)
  // Allowed prefixes: recording, camera, mic, system-audio
  const validPattern = /^(recording|camera|mic|system-audio)-\d{13,14}\.[a-z0-9]+$/;
  if (!validPattern.test(baseName)) {
    return null;
  }

  // Verify extension is in allowed list
  const ext = path.extname(baseName).toLowerCase().slice(1);
  if (!allowedExtensions.includes(ext)) {
    return null;
  }

  return baseName;
}

/**
 * Safe file write with path traversal protection.
 * Validates resolved path stays within targetDir.
 */
async function safeWriteRecording(
  targetDir: string,
  fileName: string,
  data: ArrayBuffer,
  maxSize: number,
  allowedExtensions: string[]
): Promise<{ success: boolean; path?: string; error?: string }> {
  // Validate file size
  if (data.byteLength > maxSize) {
    return { success: false, error: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` };
  }

  // Validate filename
  const safeName = validateRecordingFileName(fileName, allowedExtensions);
  if (!safeName) {
    return { success: false, error: 'Invalid filename format' };
  }

  // Build and validate path
  const targetPath = path.join(targetDir, safeName);
  const resolvedPath = path.resolve(targetPath);
  const resolvedDir = path.resolve(targetDir);

  // Defense in depth: verify path is within target directory
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return { success: false, error: 'Invalid file path' };
  }

  await fs.writeFile(resolvedPath, Buffer.from(data));
  return { success: true, path: resolvedPath };
}

export function registerIpcHandlers(
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
  showCameraOverlay?: (deviceId: string) => void,
  hideCameraOverlay?: () => void
) {
  ipcMain.handle('get-sources', async (_, opts) => {
    const sources = await desktopCapturer.getSources(opts)
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }))
  })

  ipcMain.handle('select-source', (_, source) => {
    selectedSource = source
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.close()
    }
    return selectedSource
  })

  ipcMain.handle('get-selected-source', () => {
    return selectedSource
  })

  ipcMain.handle('open-source-selector', () => {
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.focus()
      return
    }
    createSourceSelectorWindow()
  })

  ipcMain.handle('switch-to-editor', () => {
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.close()
    }
    createEditorWindow()
  })



  ipcMain.handle('store-recorded-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      const result = await safeWriteRecording(
        RECORDINGS_DIR,
        fileName,
        videoData,
        MAX_VIDEO_SIZE,
        ['webm', 'mp4', 'mov']
      );
      if (result.success && result.path) {
        currentVideoPath = result.path;
        return { ...result, message: 'Video stored successfully' };
      }
      return { ...result, message: result.error || 'Failed to store video' };
    } catch (error) {
      console.error('Failed to store video:', error);
      return {
        success: false,
        message: 'Failed to store video',
        error: String(error)
      };
    }
  })



  ipcMain.handle('get-recorded-video-path', async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR)
      const videoFiles = files.filter(file => file.endsWith('.webm'))
      
      if (videoFiles.length === 0) {
        return { success: false, message: 'No recorded video found' }
      }
      
      const latestVideo = videoFiles.sort().reverse()[0]
      const videoPath = path.join(RECORDINGS_DIR, latestVideo)
      
      return { success: true, path: videoPath }
    } catch (error) {
      console.error('Failed to get video path:', error)
      return { success: false, message: 'Failed to get video path', error: String(error) }
    }
  })

  ipcMain.handle('set-recording-state', (_, recording: boolean) => {
    const source = selectedSource || { name: 'Screen' }
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name)
    }
  })

  // Camera overlay window handlers
  ipcMain.handle('show-camera-overlay', (_, deviceId: string) => {
    if (showCameraOverlay) {
      showCameraOverlay(deviceId)
    }
  })

  ipcMain.handle('hide-camera-overlay', () => {
    if (hideCameraOverlay) {
      hideCameraOverlay()
    }
  })


  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open URL:', error)
      return { success: false, error: String(error) }
    }
  })

  // Return base path for assets so renderer can resolve file:// paths in production
  ipcMain.handle('get-asset-base-path', () => {
    try {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets')
      }
      return path.join(app.getAppPath(), 'public', 'assets')
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
    }
  })

  ipcMain.handle('save-exported-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      const mainWindow = getMainWindow();
      
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF Image', extensions: ['gif'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }];

      const dialogOptions: Electron.SaveDialogOptions = {
        title: isGif ? 'Save Exported GIF' : 'Save Exported Video',
        defaultPath: path.join(app.getPath('downloads'), fileName),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      };

      // Show dialog with parent window if available
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          cancelled: true,
          message: 'Export cancelled'
        };
      }

      await fs.writeFile(result.filePath, Buffer.from(videoData));

      return {
        success: true,
        path: result.filePath,
        message: 'Video exported successfully'
      };
    } catch (error) {
      console.error('Failed to save exported video:', error)
      return {
        success: false,
        message: 'Failed to save exported video',
        error: String(error)
      }
    }
  })

  ipcMain.handle('open-video-file-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Video File',
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: 'Video Files', extensions: ['webm', 'mp4', 'mov', 'avi', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open file picker:', error);
      return {
        success: false,
        message: 'Failed to open file picker',
        error: String(error)
      };
    }
  });

  let currentVideoPath: string | null = null;

  ipcMain.handle('set-current-video-path', (_, path: string) => {
    currentVideoPath = path;
    return { success: true };
  });

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    currentVideoPath = null;
    return { success: true };
  });

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  // Store camera recording as separate file during screen recording
  ipcMain.handle('store-camera-recording', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      return await safeWriteRecording(
        RECORDINGS_DIR,
        fileName,
        videoData,
        MAX_CAMERA_SIZE,
        ['webm', 'mp4', 'mov']
      );
    } catch (error) {
      console.error('Failed to store camera recording:', error);
      return { success: false, error: String(error) };
    }
  });

  // Store microphone audio recording as separate file
  ipcMain.handle('store-audio-recording', async (_, audioData: ArrayBuffer, fileName: string) => {
    try {
      return await safeWriteRecording(
        RECORDINGS_DIR,
        fileName,
        audioData,
        MAX_AUDIO_SIZE,
        ['webm']
      );
    } catch (error) {
      console.error('Failed to store audio recording:', error);
      return { success: false, error: String(error) };
    }
  });

  // Store system audio recording as separate file (macOS 13.2+ ScreenCaptureKit)
  ipcMain.handle('store-system-audio-recording', async (_, audioData: ArrayBuffer, fileName: string) => {
    try {
      return await safeWriteRecording(
        RECORDINGS_DIR,
        fileName,
        audioData,
        MAX_SYSTEM_AUDIO_SIZE,
        ['webm']
      );
    } catch (error) {
      console.error('Failed to store system audio recording:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get camera video path from main recording path
  ipcMain.handle('get-camera-video-path', async (_, mainVideoPath: string) => {
    try {
      // Extract timestamp from main video filename (recording-{timestamp}.webm)
      const filename = path.basename(mainVideoPath);
      const match = filename.match(/recording-(\d+)\.webm$/);

      if (!match) {
        return { success: false, path: null };
      }

      const timestamp = match[1];
      const cameraFileName = `camera-${timestamp}.webm`;
      const cameraPath = path.join(RECORDINGS_DIR, cameraFileName);

      // Security: Verify resolved path is within RECORDINGS_DIR (defense in depth)
      const resolvedPath = path.resolve(cameraPath);
      const resolvedRecordingsDir = path.resolve(RECORDINGS_DIR);
      if (!resolvedPath.startsWith(resolvedRecordingsDir + path.sep)) {
        return { success: false, path: null };
      }

      // Check if camera file exists
      try {
        await fs.access(cameraPath);
        return { success: true, path: cameraPath };
      } catch {
        // Camera file doesn't exist (recording without camera)
        return { success: false, path: null };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get microphone audio path from main recording path
  ipcMain.handle('get-mic-audio-path', async (_, mainVideoPath: string) => {
    try {
      const filename = path.basename(mainVideoPath);
      const match = filename.match(/recording-(\d+)\.webm$/);

      if (!match) {
        return { success: false, path: null };
      }

      const timestamp = match[1];
      const micFileName = `mic-${timestamp}.webm`;
      const micPath = path.join(RECORDINGS_DIR, micFileName);

      // Security: Verify resolved path is within RECORDINGS_DIR
      const resolvedPath = path.resolve(micPath);
      const resolvedRecordingsDir = path.resolve(RECORDINGS_DIR);
      if (!resolvedPath.startsWith(resolvedRecordingsDir + path.sep)) {
        return { success: false, path: null };
      }

      try {
        await fs.access(micPath);
        return { success: true, path: micPath };
      } catch {
        return { success: false, path: null };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get system audio path from main recording path
  ipcMain.handle('get-system-audio-path', async (_, mainVideoPath: string) => {
    try {
      const filename = path.basename(mainVideoPath);
      const match = filename.match(/recording-(\d+)\.webm$/);

      if (!match) {
        return { success: false, path: null };
      }

      const timestamp = match[1];
      const systemAudioFileName = `system-audio-${timestamp}.webm`;
      const systemAudioPath = path.join(RECORDINGS_DIR, systemAudioFileName);

      // Security: Verify resolved path is within RECORDINGS_DIR
      const resolvedPath = path.resolve(systemAudioPath);
      const resolvedRecordingsDir = path.resolve(RECORDINGS_DIR);
      if (!resolvedPath.startsWith(resolvedRecordingsDir + path.sep)) {
        return { success: false, path: null };
      }

      try {
        await fs.access(systemAudioPath);
        return { success: true, path: systemAudioPath };
      } catch {
        return { success: false, path: null };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
