# Code Review: Phase 02 Camera Recording Capture

**Reviewer:** code-reviewer agent (a60c015)
**Date:** 2026-01-13
**Plan:** /Users/nghia/Projects/openscreen/plans/260113-1255-camera-mic-system-audio-recording/phase-02-camera-recording-capture.md
**Score:** 6.5/10

## Scope

**Files reviewed:**
- src/types/media-devices.ts (modified)
- src/hooks/use-camera-capture.ts (NEW)
- src/components/camera-preview-overlay.tsx (NEW)
- electron/windows.ts (modified)
- electron/ipc/handlers.ts (modified)
- electron/preload.ts (modified)
- src/hooks/useScreenRecorder.ts (modified)
- src/vite-env.d.ts (modified)
- electron/electron-env.d.ts (modified)

**Lines analyzed:** ~350 new/modified
**Review focus:** Phase 02 camera recording implementation

## Overall Assessment

Implementation follows plan structure and adds camera recording infrastructure. **However, critical issues prevent successful compilation and full functionality**. Core camera capture logic is sound, but integration gaps, missing window routing, and type errors block production readiness.

Phase 02 requirements partially implemented - camera capture hooks work, but overlay window not integrated into App routing, camera overlay window not instantiated, and tests failing due to unrelated GIF export issues.

## Critical Issues

### 1. **Compilation Errors Block Build** ⚠️ BLOCKING

```
electron/ipc/handlers.ts(141,50): error TS2345
  Argument of type 'BrowserWindow | undefined' is not assignable to 'BaseWindow'
```

**Location:** Line 141 in handlers.ts
**Impact:** Build fails completely
**Root cause:** `getMainWindow()` returns `BrowserWindow | null`, passed to `showSaveDialog` expecting `BaseWindow`

**Fix:**
```typescript
// Line 141 - handlers.ts
const result = await dialog.showSaveDialog(mainWindow || undefined, {
// Should be:
const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
// Or better, type cast:
const result = await dialog.showSaveDialog((mainWindow || undefined) as Electron.BrowserWindow | undefined, {
```

### 2. **Camera Overlay Window Never Instantiated** ⚠️ BLOCKING

**Issue:** `createCameraOverlayWindow()` defined in windows.ts but never called anywhere
**Impact:** Camera overlay window specification unused, preview never shows
**Required action:** Wire camera overlay window creation to recording lifecycle

**Missing integration points:**
- Main process must call `createCameraOverlayWindow()` when recording starts with camera enabled
- Window must be destroyed when recording stops
- Position/size updates need IPC handlers

### 3. **Camera Overlay Window Type Not Routed in App.tsx** ⚠️ BLOCKING

**Issue:** App.tsx missing `case 'camera-overlay'` route
**Impact:** Even if window created, renders default fallback instead of camera preview

**Fix required in App.tsx:**
```typescript
// Add after line 25
case 'camera-overlay':
  return <CameraPreviewOverlayWrapper />;
```

**Need wrapper component** to:
- Import CameraPreviewOverlay
- Subscribe to IPC for camera stream, position, size updates
- Manage camera overlay lifecycle

### 4. **Test Failures (Pre-existing, Not Phase 02)** ⚠️

5 tests failing in `gifExporter.test.ts` due to undefined `'small'` preset
Not caused by Phase 02 changes, but blocks CI/CD

## High Priority Findings

### H1. Memory Leak Risk - Camera Stream Cleanup

**Location:** useScreenRecorder.ts lines 247-250
**Issue:** Camera stream cleanup references local `camStream` variable that may be out of scope

```typescript
// Line 247-250 in recorder.onstop handler
if (camStream) {
  camStream.getTracks().forEach(track => track.stop());
  setCameraStream(null);
}
```

**Problem:** `camStream` captured in closure but may be stale if recording stopped externally via tray
**Risk:** Camera LED stays on, tracks not released

**Recommended fix:**
```typescript
// Store camStream ref at hook level
const cameraStreamRef = useRef<MediaStream | null>(null);

// In startRecording
cameraStreamRef.current = camStream;

// In onstop handler
if (cameraStreamRef.current) {
  cameraStreamRef.current.getTracks().forEach(track => track.stop());
  cameraStreamRef.current = null;
}
```

### H2. Race Condition - Dual Recorder Stop Timing

**Location:** useScreenRecorder.ts lines 73-86
**Issue:** `stopRecording()` stops screen recorder then camera recorder sequentially, not atomically

```typescript
// Line 79-81
if (cameraRecorder.current?.state === 'recording') {
  cameraRecorder.current.stop();
}
mediaRecorder.current.stop();
```

**Risk:** If screen recorder `onstop` fires before camera recorder stopped, camera blob may not be ready
**Evidence:** Line 236 awaits `stopCameraRecording.current()` but camera recorder already stopped in line 79

**Fix:** Remove camera stop from stopRecording(), let onstop handler manage it:
```typescript
const stopRecording = useRef(() => {
  if (mediaRecorder.current?.state === "recording") {
    if (stream.current) {
      stream.current.getTracks().forEach(track => track.stop());
    }
    // Remove camera recorder stop - let onstop handler manage lifecycle
    mediaRecorder.current.stop();
    setRecording(false);
    window.electronAPI?.setRecordingState(false);
  }
});
```

### H3. Missing Error Handling - Camera Recording Storage Failure

**Location:** useScreenRecorder.ts line 240-243
**Issue:** Camera storage failure logged but recording proceeds as if successful

```typescript
const cameraResult = await window.electronAPI.storeCameraRecording(cameraBuffer, cameraFileName);
if (!cameraResult.success) {
  console.warn('Failed to store camera recording:', cameraResult.error);
}
```

**Risk:** User thinks camera recorded but file missing, no UX feedback
**Fix:** Show toast/alert on camera storage failure

### H4. Type Safety - Missing electronAPI Null Check

**Location:** useScreenRecorder.ts lines 229, 240, 253
**Issue:** `window.electronAPI` accessed without null check (only optional chaining on line 265)

**Inconsistency:** Lines 85, 265 use `window.electronAPI?.` but 229, 240, 253 assume non-null
**Fix:** Consistent optional chaining or early return if not Electron context

### H5. Unused Hook - `use-camera-capture.ts` Never Imported

**Issue:** New hook created per plan but never used
**Reason:** useScreenRecorder inlines camera logic instead of delegating

**Implications:**
- Code duplication (camera capture logic duplicated in useScreenRecorder)
- Plan deviation (plan specified separate hook)
- YAGNI violation (unused 122 lines)

**Recommendation:** Either delete hook or refactor useScreenRecorder to use it

### H6. Missing Camera Device Validation

**Location:** useScreenRecorder.ts line 144
**Issue:** `cameraDeviceId` passed in but not validated against available devices

```typescript
if (cameraDeviceId) {
  camStream = await startCameraCapture(cameraDeviceId);
```

**Risk:** If deviceId invalid/unplugged, capture fails silently, warn logged but user sees blank preview
**Fix:** Validate deviceId against `navigator.mediaDevices.enumerateDevices()` first

## Medium Priority Improvements

### M1. Duplicate Codec Selection Logic

**Locations:**
- use-camera-capture.ts lines 65-67
- useScreenRecorder.ts lines 149-151

**Issue:** Same vp9 fallback pattern repeated
**Fix:** Extract to utility function

### M2. Magic Numbers - Bitrate/Resolution

**Locations:**
- use-camera-capture.ts line 71: `2_500_000`
- useScreenRecorder.ts line 154: `2_500_000`
- use-camera-capture.ts lines 35-37: `1280x720@30`

**Issue:** Hardcoded values, no configuration
**Recommendation:** Move to constants file with documentation

### M3. Incomplete IPC Type Definitions

**Issue:** electron-env.d.ts missing `getAssetBasePath` type (exists in vite-env.d.ts)
**Impact:** Type inconsistency between env files

### M4. Missing Documentation - Camera Overlay Window Lifecycle

**Issue:** `createCameraOverlayWindow()` has no JSDoc explaining when/how to call
**Recommendation:** Add lifecycle documentation

### M5. Unused Import Type

**Location:** use-camera-capture.ts line 104
Plan shows `import type { CameraOverlayState }` but type never used in implementation

### M6. Camera Preview Not Actually Rendered

**Issue:** CameraPreviewOverlay component created but:
- Not imported in any file
- No window routing
- No IPC handlers for position/size updates

**Impact:** Component dead code until integration complete

## Low Priority Suggestions

### L1. Cleanup Comment Inconsistency

Line 39 in use-camera-capture.ts: "// Audio handled separately in mic capture"
Line 124 in useScreenRecorder.ts: "// Audio handled separately"

Both correct but could reference same constant comment

### L2. Consider Codec Fallback Chain

use-camera-capture.ts only tries vp9 → webm
useScreenRecorder tries av1 → h264 → vp9 → vp8 → webm

**Suggestion:** Align codec selection strategy

### L3. TypeScript Strict Mode Gaps

Unused parameters in several places not caught:
- `preset` in SettingsPanel.tsx line 674
- `reject` in gifExporter.ts line 255

**Recommendation:** Enable noUnusedLocals

### L4. Missing Aspect Ratio Preservation

Camera preview uses `objectFit: 'cover'` which crops
May want `contain` option for ultrawide cameras

## Positive Observations

✅ **Clean separation of concerns** - Camera capture isolated from screen recording
✅ **Proper resource cleanup** - useEffect cleanup in use-camera-capture.ts
✅ **Security conscious** - Camera stream not exposed between windows
✅ **Error boundaries** - Try/catch in critical capture paths
✅ **Type definitions comprehensive** - Both vite-env.d.ts and electron-env.d.ts updated
✅ **Platform-agnostic getUserMedia** - No macOS-specific hacks
✅ **Mirror effect** - `scaleX(-1)` for natural camera preview UX
✅ **Rounded corners design** - borderRadius: 16 matches modern UI patterns

## Recommended Actions (Priority Order)

1. **FIX CRITICAL** - Resolve TS2345 error in handlers.ts line 141
2. **FIX CRITICAL** - Add camera-overlay route to App.tsx
3. **FIX CRITICAL** - Wire createCameraOverlayWindow() to recording lifecycle in main.ts
4. **FIX HIGH** - Refactor camera stream cleanup to use ref (memory leak)
5. **FIX HIGH** - Fix race condition in dual recorder stop timing
6. **FIX HIGH** - Add error UX for camera storage failures
7. **FIX HIGH** - Decide: delete or use use-camera-capture.ts hook
8. **TEST** - Add integration test for camera + screen recording sync
9. **TEST** - Verify camera track cleanup with lsof/Activity Monitor
10. **MEDIUM** - Extract codec selection to utility
11. **MEDIUM** - Add camera device validation
12. **LOW** - Address pre-existing test failures in gifExporter

## Task Completeness Verification

**Plan TODO items (from phase-02-camera-recording-capture.md):**

- [x] Add camera overlay types to src/types/media-devices.ts
- [x] Create src/hooks/use-camera-capture.ts hook
- [x] Create src/components/camera-preview-overlay.tsx component
- [x] Add camera overlay window factory to electron/windows.ts
- [x] Add store-camera-recording IPC handler
- [x] Expose handler in electron/preload.ts
- [x] Modify useScreenRecorder.ts to integrate camera capture
- [ ] ⚠️ Test camera preview with different positions - **NOT POSSIBLE** (no window routing)
- [ ] ⚠️ Test camera preview with different sizes - **NOT POSSIBLE** (no window routing)
- [ ] ⚠️ Test recording start/stop synchronization - **BLOCKED** (compilation errors)
- [ ] ⚠️ Test camera file storage - **BLOCKED** (cannot build)
- [ ] ⚠️ Verify cleanup on recording stop - **BLOCKED** (cannot test)

**Success Criteria (from plan):**

- [ ] ❌ Camera preview shows live feed during recording - **NOT IMPLEMENTED** (no window routing)
- [ ] ❌ Preview appears in selected corner position - **NOT IMPLEMENTED**
- [ ] ❌ Preview resizes correctly (small/medium/large) - **NOT IMPLEMENTED**
- [ ] ✅ Preview has rounded corners and shadow - **CODE EXISTS** (but not rendered)
- [ ] ⚠️ Camera recording stored as separate .webm file - **IMPLEMENTED** (but untested)
- [ ] ⚠️ Both screen and camera recordings stop together - **RACE CONDITION** (see H2)
- [ ] ❌ No memory leaks (tracks properly cleaned up) - **MEMORY LEAK RISK** (see H1)

**Phase Status:** ⚠️ **INCOMPLETE** - 7/12 implementation tasks done, 0/7 success criteria fully met

## Metrics

- **Type Coverage:** ~95% (good)
- **Test Coverage:** N/A (no tests for new camera features)
- **Linting Issues:** 5 (4 pre-existing GIF export, 1 TypeScript compilation error)
- **Compilation:** ❌ FAILED
- **Build:** ❌ BLOCKED by compilation error
- **Functional:** ❌ BLOCKED - cannot test until compilation fixed and window routing added

## Security Audit

✅ Camera access gated by getUserMedia browser permission
✅ No XSS vectors (no innerHTML, dangerouslySetInnerHTML)
✅ IPC handlers validate file paths (RECORDINGS_DIR enforced)
✅ No camera stream exposure to untrusted windows
⚠️ Missing input validation on cameraDeviceId (H6)
✅ No SQL injection risk (no database queries)
✅ ArrayBuffer passed to IPC (no buffer overflows)

## Performance Analysis

**Camera Capture:**
- Target 720p@30fps = ~1.2M pixels/sec ✅ Reasonable
- 2.5 Mbps bitrate ✅ Appropriate for webcam quality
- MediaRecorder timeslice 1000ms ✅ Good balance

**Screen Recording:**
- Up to 4K@60fps = ~500M pixels/sec ⚠️ High CPU on older hardware
- Dynamic bitrate 18-76 Mbps ✅ Quality-conscious

**Preview Overlay:**
- Fixed size (320x240 max) ✅ Minimal overhead
- Native `<video>` element ✅ Hardware accelerated
- alwaysOnTop window ⚠️ Compositor impact (minor)

**Memory:**
⚠️ Two simultaneous MediaRecorders = 2x chunk buffers
⚠️ Camera stream may leak if cleanup race condition hits (H1)

## Plan File Update

**Status change:** pending → blocked
**Blockers:**
1. Compilation error in handlers.ts
2. Missing window routing in App.tsx
3. Camera overlay window never instantiated
4. Memory leak risk in camera cleanup
5. Pre-existing test failures

**Updated phase file status:**
```markdown
| Status | blocked |
| Blockers | 1. TS2345 compilation error, 2. Window routing missing, 3. Memory leak risk |
```

## Unresolved Questions

1. **When should camera overlay window be created?** Plan doesn't specify main.ts integration
2. **How to communicate camera stream to overlay window?** IPC pattern for MediaStream transfer unclear
3. **Should use-camera-capture.ts be deleted or used?** Duplicate logic with useScreenRecorder
4. **Camera/screen sync strategy?** A/V sync not addressed in implementation
5. **How to handle camera disconnection mid-recording?** No devicechange listener
6. **Camera overlay window lifecycle?** Who destroys it when recording stops?
7. **Position/size control UI?** Not implemented in LaunchWindow

---

**Next Steps:** Fix critical compilation errors, complete window routing integration, address memory leak, then proceed to testing phase. Cannot move to Phase 03 until Phase 02 success criteria met.
