# OpenScreen Code Standards

## Overview

This document defines the coding standards and conventions used throughout the OpenScreen project. All contributors must follow these guidelines to maintain consistency and code quality.

## General Principles

- **YAGNI** (You Aren't Gonna Need It) - Don't implement features prematurely
- **KISS** (Keep It Simple, Stupid) - Prefer simple solutions over complex ones
- **DRY** (Don't Repeat Yourself) - Avoid code duplication; extract reusable utilities

## File Organization

### Directory Structure

```
src/
├── components/          # React components
│   ├── launch/         # HUD overlay and source selector
│   ├── video-editor/   # Main editing interface
│   └── ui/             # Reusable UI components
├── hooks/              # React custom hooks
├── lib/                # Utilities and business logic
│   ├── exporter/       # Export pipeline
│   └── utils.ts        # General utilities
├── types/              # TypeScript type definitions
└── App.tsx             # Window router

electron/
├── main.ts             # App entry point
├── windows.ts          # Window factories
├── preload.ts          # IPC bridge
├── ipc/
│   └── handlers.ts     # IPC request handlers
└── electron-env.d.ts   # Type definitions

docs/
├── codebase-summary.md        # Project overview and structure
├── system-architecture.md     # Architecture and data flow
├── code-standards.md          # This file
├── project-overview-pdr.md    # Product requirements
└── (more docs as needed)
```

### File Naming Conventions

**TypeScript/React Files**:
- Use `kebab-case` for file names
- Use descriptive names that indicate purpose
- Component files: describe the component clearly
  - Good: `use-media-devices.ts`, `video-playback.tsx`, `device-selector.tsx`
  - Bad: `hook.ts`, `component.tsx`, `comp.tsx`

**Test Files**:
- Same name as source with `.test.ts` or `.spec.ts` suffix
  - Example: `platform-utils.ts` → `platform-utils.test.ts`

**CSS/Module Files**:
- Use `.module.css` for scoped styles
- Example: `LaunchWindow.module.css` pairs with `LaunchWindow.tsx`

### File Size Management

**Target Limits**:
- Code files: Keep under 200 lines of code (LOC)
- Documentation files: Keep under 800 lines (split into multiple files if needed)

**When to Split**:
- **Components**: Extract sub-components into separate files
- **Hooks**: Extract shared logic into separate hooks
- **Utilities**: Group related functions into separate modules
- **Types**: Group related types by domain

**Refactoring Approach**:
1. Identify logical boundaries (features, concerns, domains)
2. Extract into new files with clear purposes
3. Use index files for cleaner imports
4. Update cross-references and imports

Example:
```typescript
// Before: timeline/TimelineEditor.tsx (350+ lines)

// After:
// timeline/
//   ├── index.ts (exports)
//   ├── timeline-editor.tsx (main component)
//   ├── timeline-track.tsx (audio track)
//   ├── timeline-ruler.tsx (time ruler)
//   └── timeline-utils.ts (helper functions)
```

## TypeScript Standards

### Type Definitions

**Always use explicit types**:
```typescript
// Good
const devices: MediaDeviceInfo[] = [];
const selectedId: string | null = null;
function handleSelect(id: string): void { }

// Avoid
const devices = [];
const selectedId = null;
function handleSelect(id) { }
```

**Use interfaces for object shapes**:
```typescript
// Good - clear contract
interface UseMediaDevicesReturn {
  cameras: MediaDeviceInfo[];
  selectedCameraId: string | null;
  setSelectedCameraId(id: string | null): void;
}

// Avoid - unclear what this object contains
type ReturnValue = any;
```

**Organize types by domain**:
```typescript
// Good - types/media-devices.ts
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';
export interface MediaDeviceState { }
export interface UseMediaDevicesReturn { }

// Avoid
// Scattered type definitions across files
```

### Const Assertions

Use `as const` for compile-time constants:
```typescript
// Good
export const DEVICE_STORAGE_KEYS = {
  SELECTED_CAMERA: 'openscreen:selectedCameraId',
  SELECTED_MIC: 'openscreen:selectedMicId',
} as const;

// Usage
const key = DEVICE_STORAGE_KEYS.SELECTED_CAMERA; // type: 'openscreen:selectedCameraId'
```

### Error Handling

Always catch errors explicitly:
```typescript
// Good
try {
  const devices = await navigator.mediaDevices.enumerateDevices();
} catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error('Failed to enumerate devices:', err);
  setError(message);
}

// Avoid
try {
  // ...
} catch (err) {
  // Silently ignore
}
```

## React Standards

### Hooks

**Use TypeScript for hook returns**:
```typescript
// Good
export function useMediaDevices(): UseMediaDevicesReturn {
  // implementation
}

// Avoid
export function useMediaDevices() {
  // implementation
}
```

**Manage dependencies correctly**:
```typescript
// Good - all dependencies listed
const setSelectedCameraId = useCallback(
  (id: string | null) => {
    // ...
  },
  [cameras] // cameras is a dependency
);

// Avoid - missing dependencies
const setSelectedCameraId = useCallback(
  (id: string | null) => {
    if (cameras.some(d => d.deviceId === id)) { } // cameras used but not in deps
  },
  [] // WRONG!
);
```

**Cleanup event listeners**:
```typescript
// Good - returns cleanup function
useEffect(() => {
  const handler = () => { /* ... */ };
  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () => {
    navigator.mediaDevices.removeEventListener('devicechange', handler);
  };
}, []);

// Avoid - memory leak!
useEffect(() => {
  const handler = () => { /* ... */ };
  navigator.mediaDevices.addEventListener('devicechange', handler);
  // No cleanup function
}, []);
```

**Persist state to storage**:
```typescript
// Good - load from storage with fallback
const [value, setValue] = useState(() =>
  loadFromStorage(STORAGE_KEY, defaultValue)
);

// Save when value changes
useEffect(() => {
  saveToStorage(STORAGE_KEY, value);
}, [value]);

// Avoid - storage operations in render
```

### Component Structure

```typescript
// Good component structure
import { useState, useEffect, useCallback } from 'react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

interface DeviceSelectorProps {
  onSelect: (id: string) => void;
}

export function DeviceSelector({ onSelect }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    // effects
  }, []);

  const handleSelect = useCallback((id: string) => {
    onSelect(id);
  }, [onSelect]);

  return (
    <div>
      {devices.map(device => (
        <Button key={device.deviceId} onClick={() => handleSelect(device.deviceId)}>
          {device.label}
        </Button>
      ))}
    </div>
  );
}
```

## Code Style

### Formatting

- **Line length**: Keep lines under 100 characters where reasonable
- **Indentation**: 2 spaces (configured in .editorconfig)
- **Semicolons**: Required (enforced by linter)
- **Quotes**: Use single quotes for strings, backticks for templates

### Naming Conventions

**Variables and Functions**:
- Use `camelCase` for variables and functions
- Use descriptive names that indicate purpose
```typescript
// Good
const selectedCameraId = cameras[0]?.deviceId;
function enumerateDevices() { }
const isLoading = true;

// Avoid
const cam = cameras[0]?.deviceId;
function enum_dev() { }
const loading = true;
```

**Constants**:
- Use `UPPER_SNAKE_CASE` for compile-time constants
```typescript
// Good
const MAX_DEVICES = 10;
const STORAGE_PREFIX = 'openscreen:';

export const DEVICE_STORAGE_KEYS = {
  SELECTED_CAMERA: 'openscreen:selectedCameraId',
} as const;

// Avoid
const max_devices = 10;
const storagePrefix = 'openscreen:';
```

**React Components**:
- Use `PascalCase` for component names
- Use descriptive names indicating what it does
```typescript
// Good
export function DeviceSelector() { }
export function VideoPlayback() { }
function RecordButton() { }

// Avoid
export function selector() { }
export function VideoPlayback2() { }
```

**Booleans and Status**:
- Use `is*`, `has*`, `should*`, `can*` prefixes
```typescript
// Good
const isLoading = true;
const hasError = false;
const shouldRefresh = true;
const canCapture = devices.length > 0;

// Avoid
const loading = true;
const error = false;
const refresh = true;
const capture = devices.length > 0;
```

### Comments

**When to comment**:
- Document "why" not "what" (code shows what)
- Explain non-obvious logic
- Warn about gotchas or performance considerations

```typescript
// Good - explains why
// Device labels are only visible after permission granted,
// so we check if labels exist to determine permission status
const hasPermission = devices.some(d => d.label && d.label.length > 0);

// Document complex logic
// Cache device list to avoid re-enumeration on every state change.
// Only update when devices actually change.
const devices = useRef<MediaDeviceInfo[]>([]);

// Avoid - restates code
const selectedId = id; // Set selectedId to id
const count = devices.length; // Get count of devices
```

**JSDoc for exports**:
```typescript
/**
 * Hook for media device enumeration and selection.
 * Provides camera/mic lists, selection state, and permission handling.
 * Persists device selection to localStorage for better UX.
 *
 * @example
 * const { cameras, microphones, selectedCameraId, setSelectedCameraId } = useMediaDevices();
 *
 * @returns UseMediaDevicesReturn - Device list and control methods
 */
export function useMediaDevices(): UseMediaDevicesReturn {
  // implementation
}
```

## Testing Standards

### Test File Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { supportsSystemAudio, getMacOSVersion } from '@/lib/platform-utils';

describe('platform-utils', () => {
  describe('getMacOSVersion', () => {
    it('should return null if not on macOS', () => {
      // test
    });

    it('should parse macOS version from user agent', () => {
      // test
    });

    it('should handle underscore separator in version', () => {
      // test
    });
  });

  describe('supportsSystemAudio', () => {
    it('should return true for macOS 13.2+', () => {
      // test
    });

    it('should return false for older macOS versions', () => {
      // test
    });
  });
});
```

### Test Naming

- Test names should describe the scenario and expected behavior
- Use "should" for clarity

```typescript
// Good
it('should return true when version is 14.0', () => { });
it('should handle device without label', () => { });
it('should persist selection to localStorage', () => { });

// Avoid
it('test version', () => { });
it('works', () => { });
it('devicechange event', () => { });
```

### Coverage Goals

- Aim for 80%+ code coverage
- 100% coverage for critical paths (device selection, permissions)
- Test error scenarios and edge cases

## Web Worker Standards

### Worker Architecture

**When to use workers**:
- CPU-intensive frame rendering (Phase 2: Parallel rendering)
- Long-running computations
- Heavy data processing that would block main thread

**When NOT to use workers**:
- Simple state updates
- DOM manipulation (workers don't have DOM access)
- Async operations that don't block main thread
- Small computations

### Worker Implementation

**Module Structure**:
```typescript
// src/lib/exporter/workers/
// ├── worker-types.ts         # Message types & interfaces
// ├── render-worker.ts        # Worker entry point
// └── worker-pixi-renderer.ts # Worker-specific logic
```

**Message Protocol**:
```typescript
// Always define explicit message types
interface WorkerMessage {
  type: 'INIT' | 'RENDER' | 'ERROR';
  data: unknown;
}

// Worker entry point
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data;
  switch (type) {
    case 'INIT':
      // Setup
      break;
    case 'RENDER':
      const result = await render(data);
      self.postMessage({ type: 'RENDERED', result }, [/* transferables */]);
      break;
  }
};
```

**Zero-Copy Transfers**:
```typescript
// Good - use Transferable for large objects
const canvas = new OffscreenCanvas(width, height);
// ... render to canvas ...
worker.postMessage(
  { type: 'RENDERED', canvas },
  [canvas] // Transfer ownership (zero-copy)
);

// Avoid - copying large data
worker.postMessage({
  type: 'RENDERED',
  canvasData: canvasElement.getImageData(...) // Creates copy
});
```

**Error Handling**:
```typescript
// Good - propagate worker errors
worker.onerror = (error) => {
  console.error('Worker error:', error.message);
  // Fallback to single-threaded rendering
};

// Handle exceptions in worker code
try {
  const result = await processFrame(data);
  self.postMessage({ type: 'RENDERED', result });
} catch (error) {
  self.postMessage({
    type: 'ERROR',
    message: error instanceof Error ? error.message : 'Unknown error'
  });
}
```

### Worker Pool Pattern (Phase 2)

**Pool Management**:
```typescript
// Good - fixed worker count
class WorkerPool {
  private workers: Worker[] = [];
  private idle: boolean[] = [];

  constructor(count: number = 4) { // Validate optimal count
    for (let i = 0; i < count; i++) {
      this.workers.push(new Worker(workerUrl));
      this.idle[i] = true;
    }
  }

  async renderFrame(frame, config) {
    const workerIdx = this.idle.findIndex(idle => idle);
    this.idle[workerIdx] = false;
    // Send to worker...
  }

  destroy() {
    this.workers.forEach(w => w.terminate());
  }
}
```

**Fallback Pattern**:
```typescript
// Good - graceful fallback if workers unavailable
export class RenderCoordinator {
  private workerPool: WorkerPool | null = null;
  private fallbackRenderer: FrameRenderer | null = null;

  async initialize() {
    if (typeof Worker === 'undefined') {
      await this.initializeFallback();
      return;
    }

    try {
      await this.initializeWorkerPool();
    } catch (error) {
      console.warn('Workers failed, using fallback', error);
      await this.initializeFallback();
    }
  }

  async renderFrame(data) {
    if (this.workerPool) {
      return this.workerPool.renderFrame(data);
    } else {
      return this.fallbackRenderer.render(data);
    }
  }
}
```

## Electron Standards

### Main Process (electron/main.ts)

- Keep main process minimal
- Delegate UI to renderer
- Use IPC for async operations

```typescript
// Good - IPC for file operations
ipcMain.handle('SELECT_FILE', async (event, options) => {
  const result = await dialog.showOpenDialog(options);
  return result;
});

// Avoid - blocking operations in main process
```

### IPC Messages

**Message Format**:
```typescript
interface IPCMessage {
  type: string;  // Message type
  payload?: any; // Data
}
```

**Naming**:
- Use UPPER_SNAKE_CASE for message types
- Be explicit about direction (CLIENT_, MAIN_)

```typescript
// Good
const START_CAPTURE = 'START_CAPTURE';
const CAPTURE_FRAME = 'CAPTURE_FRAME';

// Avoid
const start = 'start';
const frame = 'frame';
```

### Preload Security

**Do**:
- Expose only necessary APIs via `window.electronAPI`
- Validate all inputs from renderer
- Use IPC handlers for sensitive operations

**Don't**:
- Expose entire `ipcRenderer` to renderer
- Allow arbitrary code execution
- Bypass security checks

## Git & Commits

### Commit Messages

Use conventional commit format:
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat:` New feature
- `fix:` Bug fix
- `refactor:` Code refactoring (no functional change)
- `style:` Formatting, missing semicolons, etc.
- `test:` Test additions or changes
- `docs:` Documentation changes
- `chore:` Build, dependency updates

**Examples**:
```
feat(media-devices): add localStorage persistence for device selection

fix(platform-utils): handle Mac OS X version parsing with underscores

docs(architecture): document media device infrastructure

test(use-media-devices): add tests for device validation
```

### Branch Naming

```
feat/feature-name
fix/issue-name
refactor/component-name
docs/feature-name
```

## Linting & Formatting

### ESLint Configuration

The project uses ESLint for code quality checks.

```bash
npm run lint      # Check for issues
npm run lint:fix  # Auto-fix issues (when possible)
```

**Enforced Rules**:
- No unused variables
- No unused imports
- Proper TypeScript types
- React hooks dependencies
- No console.log in production code (warn only)

### Pre-commit Checks

Before committing:
1. Run `npm run lint:fix` to auto-fix style issues
2. Ensure no linting errors remain: `npm run lint`
3. Run tests: `npm run test`
4. Check TypeScript: `npm run build` (partial check)

## Documentation Standards

### Code Documentation

**Every public export should have JSDoc**:
```typescript
/**
 * Load persisted value from localStorage with type safety.
 *
 * @template T - Type of value to load
 * @param key - localStorage key
 * @param defaultValue - Value if key not found or parse fails
 * @returns Loaded value or default
 *
 * @example
 * const camera = loadFromStorage('selectedCamera', null);
 */
export function loadFromStorage<T>(key: string, defaultValue: T): T {
  // implementation
}
```

### File Headers

Include description at top of file:
```typescript
/**
 * Hook for media device enumeration and selection.
 * Provides camera/mic lists, selection state, and permission handling.
 * Persists device selection to localStorage for better UX.
 */
```

### README in Components

For complex components, add README:
```
components/video-editor/
├── README.md
├── VideoEditor.tsx
├── VideoPlayback.tsx
└── ...
```

## Code Review Checklist

Before submitting PR, verify:

- [ ] TypeScript types are explicit and correct
- [ ] Error handling is present for async operations
- [ ] Memory leaks cleaned up (event listeners, subscriptions)
- [ ] Component logic is tested
- [ ] No console.log in production code
- [ ] Linting passes: `npm run lint`
- [ ] Tests pass: `npm run test`
- [ ] Files under 200 LOC (split if needed)
- [ ] Names are descriptive and follow conventions
- [ ] JSDoc added for public exports
- [ ] Commit messages follow conventional format

## Breaking Changes

When introducing breaking changes:
1. Update CHANGELOG.md with migration guide
2. Update affected documentation
3. Provide deprecation warnings in code
4. Add comments explaining why change was necessary

## Performance Guidelines

### React Performance

- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Memoize components only when profiling shows benefit
- Lazy load heavy components

### API Calls

- Debounce or throttle high-frequency operations
- Cache results when possible
- Handle errors and timeouts

### Memory Management

- Clean up event listeners in useEffect cleanup
- Don't store MediaStream objects longer than needed
- Release references to large objects when done

## Accessibility Standards

### ARIA Attributes

- Use semantic HTML where possible
- Add ARIA labels for non-obvious elements
- Use ARIA live regions for dynamic content updates

### Keyboard Navigation

- All interactive elements must be keyboard accessible
- Use native HTML buttons and inputs where possible
- Test with keyboard-only navigation

### Color Contrast

- Ensure text contrast ratio ≥ 4.5:1 for normal text
- Use color in addition to other indicators (not color alone)

## Security Standards

### Input Validation

- Validate all user inputs before use
- Validate IPC messages from renderer
- Sanitize file paths before operations

### Storage

- Don't store sensitive data in localStorage
- Use secure storage for credentials (system keychain if available)
- Clear sensitive data when session ends

### Dependencies

- Keep dependencies up to date
- Review security advisories regularly
- Use lock file (package-lock.json) in git

## License

All code must comply with the project license (MIT). Include license header in new files:

```typescript
/**
 * OpenScreen - A free, open-source screen recording app
 * Copyright (c) 2024-2026
 * Licensed under the MIT License
 */
```

## References

- TypeScript Handbook: https://www.typescriptlang.org/docs/
- React Documentation: https://react.dev/
- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- ESLint: https://eslint.org/docs/
- Vitest: https://vitest.dev/
