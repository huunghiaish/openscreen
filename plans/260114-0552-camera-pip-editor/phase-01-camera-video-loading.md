# Phase 1: Camera Video Loading

## Overview

- **Priority**: P1
- **Status**: completed
- **Completed**: 2026-01-14
- **Estimated Time**: 1.5h
- **Actual Time**: ~2h (1h implementation + 1h linting cleanup)

Load camera video file in editor when available, paired with main screen recording.

**Review Report**: [code-reviewer-260114-0605-phase1-camera-loading.md](../reports/code-reviewer-260114-0605-phase1-camera-loading.md)
**Review Score**: 7.5/10 (implementation excellent, codebase linting issues blocking)

## Key Insights

- Camera recordings saved as `camera-{timestamp}.webm` in RECORDINGS_DIR
- Main recordings saved as `recording-{timestamp}.webm` with same timestamp
- Need IPC handler to resolve camera file path from main video path
- Editor already loads main video via `getCurrentVideoPath` IPC

## Requirements

### Functional
- Detect camera video file from recording timestamp
- Load camera video path via IPC
- Create hidden HTML video element for camera
- Handle missing camera gracefully (no error, just hide PiP)

### Non-Functional
- No UI changes in this phase
- Camera video should preload metadata only

## Architecture

```
VideoEditor.tsx
├── useEffect (load camera video)
│   ├── Extract timestamp from main video path
│   ├── Call IPC: get-camera-video-path
│   └── setCameraVideoPath(path | null)
│
└── State
    ├── cameraVideoPath: string | null
    └── cameraVideoReady: boolean
```

## Related Code Files

**Modify:**
- `electron/ipc/handlers.ts` - Add `get-camera-video-path` handler
- `electron/preload.ts` - Expose new IPC method
- `src/types/electron.d.ts` - Add type for new API
- `src/components/video-editor/VideoEditor.tsx` - Load camera video

**Reference:**
- `src/hooks/useScreenRecorder.ts` - Camera filename pattern (line 252)
- `electron/ipc/handlers.ts` - Current video path handling (line 223-232)

## Implementation Steps

### Step 1: Add IPC Handler

Add to `electron/ipc/handlers.ts`:

```typescript
ipcMain.handle('get-camera-video-path', async (_, mainVideoPath: string) => {
  try {
    // Extract timestamp from main video filename
    // Pattern: recording-{timestamp}.webm
    const filename = path.basename(mainVideoPath);
    const match = filename.match(/recording-(\d+)\.webm$/);

    if (!match) {
      return { success: false, path: null };
    }

    const timestamp = match[1];
    const cameraFileName = `camera-${timestamp}.webm`;
    const cameraPath = path.join(RECORDINGS_DIR, cameraFileName);

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
```

### Step 2: Update Preload

Add to `electron/preload.ts`:

```typescript
getCameraVideoPath: (mainVideoPath: string) =>
  ipcRenderer.invoke('get-camera-video-path', mainVideoPath),
```

### Step 3: Update Type Definitions

Add to `src/types/electron.d.ts`:

```typescript
getCameraVideoPath: (mainVideoPath: string) => Promise<{
  success: boolean;
  path?: string | null;
  error?: string;
}>;
```

### Step 4: Load Camera Video in Editor

Add to `VideoEditor.tsx`:

```typescript
const [cameraVideoPath, setCameraVideoPath] = useState<string | null>(null);

// Load camera video path when main video loads
useEffect(() => {
  async function loadCameraVideo() {
    if (!videoPath) return;

    // Convert file URL back to path
    const mainPath = videoPath.replace(/^file:\/\//, '');

    const result = await window.electronAPI.getCameraVideoPath(mainPath);
    if (result.success && result.path) {
      setCameraVideoPath(toFileUrl(result.path));
    } else {
      setCameraVideoPath(null);
    }
  }

  loadCameraVideo();
}, [videoPath]);
```

## Todo List

- [x] Add `get-camera-video-path` IPC handler in handlers.ts
- [x] Update preload.ts with new API
- [x] Update electron.d.ts type definitions (both electron-env.d.ts and vite-env.d.ts)
- [x] Add cameraVideoPath state in VideoEditor
- [x] Add useEffect to load camera video when main video loads
- [x] Fix 35 pre-existing linting errors (ESLint cleanup)
- [x] Remove development console.log and code comments
- [x] Code review passed
- [ ] Test with recording that has camera (Phase 2+)
- [ ] Test with recording without camera (Phase 2+)

## Success Criteria

1. IPC handler correctly resolves camera path from main video path
2. Camera video path loaded when main video has matching camera file
3. No errors when camera file doesn't exist
4. Camera path available in VideoEditor state for next phase

## Security Considerations

- ✅ Validate file paths stay within RECORDINGS_DIR
- ✅ Use fs.access for existence check (no arbitrary file reads)
- ✅ No arbitrary user input in path construction (uses path.basename + path.join)
- ⚠️ Consider adding explicit path validation for defense-in-depth

## Blockers

1. **35 pre-existing linting errors** must be fixed before merge:
   - 10 errors: `@typescript-eslint/no-explicit-any` violations
   - 3 errors: Empty catch/block statements
   - 3 errors: Unused variables
   - Other minor violations
2. Development console.log should be removed or gated behind DEV flag

## Next Steps

### Before Phase 2:
1. Fix linting errors across codebase
2. Remove development console.log
3. Add integration tests for camera loading
4. Test with recordings (with/without camera)

### After Phase 1 Complete:
After this phase, `cameraVideoPath` state will be available in VideoEditor. Phase 2 will use this to display the PiP overlay in the preview.
