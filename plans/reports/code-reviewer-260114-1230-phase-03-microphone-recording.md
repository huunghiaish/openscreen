# Code Review: Phase 03 Microphone Recording

## Code Review Summary

### Scope
- Files reviewed:
  - `src/hooks/use-microphone-capture.ts` (215 lines, created)
  - `src/components/audio-level-meter.tsx` (63 lines, created)
  - `src/hooks/useScreenRecorder.ts` (446 lines, modified ~100 lines)
  - `electron/ipc/handlers.ts` (modified, +10 lines)
  - `electron/preload.ts` (modified, +3 lines)
  - Type definitions in `src/vite-env.d.ts` and `electron/electron-env.d.ts`
- Lines of code analyzed: ~950 total
- Review focus: Phase 03 microphone recording implementation
- Updated plans: phase-03-microphone-recording.md (marked complete)

### Overall Assessment

**Score: 7.5/10**

Implementation follows existing patterns, has proper resource cleanup, and compiles without errors. Architecture is well-structured with separation of concerns. Code quality is good with comprehensive documentation.

However, missing critical file size validation, lacks user-facing error handling, has potential memory leak with stale closure, and needs refactoring due to excessive file length (446 lines).

### Critical Issues

**C1. Path Traversal Vulnerability in IPC Handler**
- Location: `electron/ipc/handlers.ts:264-273`
- Issue: `fileName` parameter not validated before path.join, allows directory traversal
- Impact: Attacker could write to arbitrary filesystem locations
- Example: `fileName = "../../.ssh/authorized_keys"` overwrites system files
- Fix:
```typescript
ipcMain.handle('store-audio-recording', async (_, audioData: ArrayBuffer, fileName: string) => {
  try {
    // Sanitize fileName - strip path separators and parent references
    const sanitizedFileName = path.basename(fileName.replace(/\.\./g, ''));
    if (!sanitizedFileName || !/^[a-zA-Z0-9_-]+\.webm$/.test(sanitizedFileName)) {
      return { success: false, error: 'Invalid file name' };
    }
    const audioPath = path.join(RECORDINGS_DIR, sanitizedFileName);
    await fs.writeFile(audioPath, Buffer.from(audioData));
    return { success: true, path: audioPath };
  } catch (error) {
    console.error('Failed to store audio recording:', error);
    return { success: false, error: String(error) };
  }
});
```

**C2. Memory Exhaustion - No ArrayBuffer Size Limit**
- Location: `electron/ipc/handlers.ts:264`, `preload.ts:80`
- Issue: No validation on audioData size before writing to disk
- Impact: Malicious/buggy code could send 1GB+ buffers, crash app, fill disk
- Example: User records for hours without size check
- Fix:
```typescript
// In handlers.ts
const MAX_AUDIO_SIZE = 500 * 1024 * 1024; // 500MB max
if (audioData.byteLength > MAX_AUDIO_SIZE) {
  return { success: false, error: 'Audio file exceeds maximum size' };
}
```

### High Priority Findings

**H1. Stale Closure Bug in stopRecording**
- Location: `useScreenRecorder.ts:393-398`
- Issue: Uses `cameraStreamRef.current` in onstop callback but should verify it still exists
- Impact: Race condition if component unmounts during recording stop
- Fix: Add null check:
```typescript
if (cameraStreamRef.current) {
  cameraStreamRef.current.getTracks().forEach(track => track.stop());
  cameraStreamRef.current = null;
  setCameraStream(null);
}
```
- Current code has check (line 394), but pattern repeated at 410-414 without defensive checks

**H2. Missing User Error Feedback**
- Location: `useScreenRecorder.ts:389, 377-378`
- Issue: Mic/camera failures only console.warn, user sees no error
- Impact: Silent failures confuse users ("why isn't mic working?")
- Fix: Add toast notifications or error state:
```typescript
const [micError, setMicError] = useState<string | null>(null);
// In startMicCapture catch block:
setMicError('Microphone access denied');
// Return error in hook interface
```

**H3. AudioContext Not Closed on startCapture Error**
- Location: `use-microphone-capture.ts:74-103`
- Issue: If getUserMedia succeeds but AudioContext setup fails, context not closed
- Impact: Memory leak from unclosed AudioContext
- Fix: Wrap AudioContext setup in try-catch, cleanup on error:
```typescript
try {
  audioContext.current = new AudioContext();
  // ... setup
} catch (err) {
  if (audioContext.current) {
    audioContext.current.close();
    audioContext.current = null;
  }
  // ... existing error handling
}
```

**H4. useScreenRecorder File Exceeds 200 Line Limit**
- Location: `useScreenRecorder.ts` (446 lines)
- Issue: Violates modularization guideline (200 line max)
- Impact: Hard to maintain, review, test
- Recommendation: Extract into separate hooks:
  - `use-camera-capture.ts` (startCameraCapture + recording logic)
  - `use-mic-capture.ts` (already exists but not used, duplicate in useScreenRecorder)
  - `use-screen-capture.ts` (core screen recording logic)
  - `use-multi-stream-recorder.ts` (orchestration)

### Medium Priority Improvements

**M1. Duplicate Mic Capture Logic**
- Location: `useScreenRecorder.ts:210-242` vs `use-microphone-capture.ts`
- Issue: Mic capture logic duplicated instead of using useMicrophoneCapture hook
- Impact: Code duplication violates DRY principle
- Fix: Refactor useScreenRecorder to use useMicrophoneCapture hook

**M2. Hardcoded Magic Numbers**
- Location: Multiple files
- Examples:
  - `rms * 300` (line 64, 117) - sensitivity multiplier
  - `fftSize = 256` (line 94, 231) - FFT buffer size
  - `128_000` (line 153, 288) - audio bitrate
- Fix: Extract to named constants:
```typescript
const AUDIO_LEVEL_SENSITIVITY = 300;
const FFT_SIZE = 256;
const AUDIO_BITRATE = 128_000;
```

**M3. Missing MIME Type Fallback Logging**
- Location: `useScreenRecorder.ts:283-285`, `use-microphone-capture.ts:147-149`
- Issue: Falls back to 'audio/webm' silently if Opus not supported
- Impact: User unaware of degraded codec quality
- Fix: Log warning when fallback occurs

**M4. No Validation for Audio Level Range**
- Location: `audio-level-meter.tsx:25`
- Issue: Assumes level is 0-100, no validation
- Impact: Invalid values could break UI
- Fix:
```typescript
const activeBars = Math.round(Math.max(0, Math.min(100, level)) / 100 * barCount);
```

**M5. Insufficient Error Context**
- Location: `useScreenRecorder.ts:389, 239`
- Issue: Generic error messages lack actionable details
- Fix: Provide specific guidance:
```typescript
console.warn('Microphone capture failed. Check system permissions in Settings > Privacy & Security > Microphone', err);
```

### Low Priority Suggestions

**L1. Use CSS Variables Instead of Inline Styles**
- Location: `audio-level-meter.tsx:28-35, 50-57`
- Issue: Inline styles reduce maintainability
- Fix: Extract to Tailwind classes or CSS module

**L2. Add Accessible Labels**
- Location: `audio-level-meter.tsx`
- Issue: No ARIA labels for screen readers
- Fix:
```typescript
<div role="meter" aria-label="Microphone audio level" aria-valuenow={level} aria-valuemin={0} aria-valuemax={100}>
```

**L3. Type Definition Comments**
- Location: `useScreenRecorder.ts:4-15`
- Issue: Interface lacks JSDoc comments
- Fix: Add documentation matching useMicrophoneCapture style

**L4. Console Logging in Production**
- Location: Multiple console.warn/console.error calls
- Issue: Exposes internal errors in production builds
- Fix: Use proper logging library with levels (e.g., electron-log)

### Positive Observations

1. **Excellent Documentation**: Both hooks have comprehensive JSDoc comments explaining purpose, behavior, parameters
2. **Proper Resource Cleanup**: useEffect cleanup in both hooks properly closes AudioContext, stops streams, cancels animation frames
3. **Follows Existing Patterns**: IPC handler structure matches store-camera-recording pattern
4. **Type Safety**: Comprehensive TypeScript interfaces with proper exports
5. **Performance Optimized**: Uses requestAnimationFrame for 60fps level metering, low FFT size (256) for fast updates
6. **Codec Selection Logic**: Intelligent fallback from Opus to generic WebM
7. **RMS Calculation**: Proper audio level calculation using root mean square algorithm
8. **Error Resilience**: Recording continues if camera/mic capture fails

### Recommended Actions

1. **CRITICAL** - Fix path traversal vulnerability in store-audio-recording handler (C1)
2. **CRITICAL** - Add file size validation to prevent memory exhaustion (C2)
3. **HIGH** - Add user-facing error notifications for mic/camera failures (H2)
4. **HIGH** - Fix AudioContext cleanup in error path (H3)
5. **MEDIUM** - Refactor useScreenRecorder to use useMicrophoneCapture hook (M1)
6. **MEDIUM** - Plan refactoring to split useScreenRecorder into sub-hooks (H4)
7. **LOW** - Add ARIA labels for accessibility (L2)
8. **LOW** - Replace console.* with proper logging library (L4)

### Metrics

- Type Coverage: 100% (no any types except documented Electron API)
- Test Coverage: Not measured (no tests run)
- Linting Issues: 0 errors (ESLint passed)
- Build Status: Success (compiles to DMG for macOS x64/arm64)
- File Size Compliance: 1/3 files exceed 200 lines (useScreenRecorder: 446 lines)

### Unresolved Questions

1. Should microphone recording stop if audio level is 0 for extended period (battery optimization)?
2. What happens if user changes mic device mid-recording? Currently would continue with old device.
3. Should there be a maximum recording duration limit for audio files?
4. How are orphaned audio files cleaned up if video recording fails but mic succeeds?
5. Should echo cancellation be configurable via settings? Current hardcoded to true.
