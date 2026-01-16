# Phase 3: PiP Position Controls

## Overview

- **Priority**: P2
- **Status**: completed (2026-01-14 07:09)
- **Estimated Time**: 1.5h
- **Actual Time**: 1.5h
- **Review Report**: [code-reviewer-260114-0657-phase3-pip-controls.md](../reports/code-reviewer-260114-0657-phase3-pip-controls.md)
- **Test Results**: 35/35 passing
- **Code Quality**: 9/10

Add UI controls in SettingsPanel for camera PiP position and size selection.

## Key Insights

- SettingsPanel already handles zoom, crop, export settings
- Should follow existing UI patterns (tabs, sliders, toggles)
- Controls only visible when camera video exists
- Position: 4-corner selector (visual grid)
- Size: 3 presets (small/medium/large)

## Requirements

### Functional
- Position selector with 4 corner options
- Size selector with 3 presets
- Enable/disable toggle for PiP
- Visual feedback showing current selection
- Controls hidden when no camera video

### Non-Functional
- Consistent with existing SettingsPanel styling
- Immediate preview update on change

## Architecture

```
SettingsPanel.tsx
└── Camera PiP Section (conditional)
    ├── Enable/Disable Toggle
    ├── Position Selector
    │   └── 2x2 grid of corner buttons
    └── Size Selector
        └── 3 buttons (Small, Medium, Large)
```

## Related Code Files

**Create:**
- `src/components/video-editor/CameraPipSettings.tsx`

**Modify:**
- `src/components/video-editor/SettingsPanel.tsx` - Add PiP settings section
- `src/components/video-editor/VideoEditor.tsx` - Pass handlers to SettingsPanel

## Implementation Steps

### Step 1: Create CameraPipSettings Component

Create `src/components/video-editor/CameraPipSettings.tsx`:

```typescript
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Video } from 'lucide-react';
import type { CameraPipConfig, CameraPipPosition, CameraPipSize } from './types';

interface CameraPipSettingsProps {
  config: CameraPipConfig;
  onConfigChange: (config: Partial<CameraPipConfig>) => void;
}

const POSITIONS: { id: CameraPipPosition; label: string; row: number; col: number }[] = [
  { id: 'top-left', label: 'TL', row: 0, col: 0 },
  { id: 'top-right', label: 'TR', row: 0, col: 1 },
  { id: 'bottom-left', label: 'BL', row: 1, col: 0 },
  { id: 'bottom-right', label: 'BR', row: 1, col: 1 },
];

const SIZES: { id: CameraPipSize; label: string }[] = [
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
];

export function CameraPipSettings({ config, onConfigChange }: CameraPipSettingsProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Video className="w-4 h-4 text-[#34B27B]" />
        <span className="text-sm font-medium text-slate-200">Camera PiP</span>
      </div>

      {/* Enable Toggle */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 mb-3">
        <span className="text-xs font-medium text-slate-200">Show Camera</span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onConfigChange({ enabled })}
          className="data-[state=checked]:bg-[#34B27B]"
        />
      </div>

      {config.enabled && (
        <>
          {/* Position Selector */}
          <div className="mb-3">
            <div className="text-xs font-medium text-slate-400 mb-2">Position</div>
            <div className="grid grid-cols-2 gap-2 w-24">
              {POSITIONS.map((pos) => (
                <button
                  key={pos.id}
                  onClick={() => onConfigChange({ position: pos.id })}
                  className={cn(
                    'w-10 h-10 rounded-lg border-2 transition-all flex items-center justify-center',
                    config.position === pos.id
                      ? 'border-[#34B27B] bg-[#34B27B]/20 text-[#34B27B]'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                  )}
                >
                  <div
                    className={cn(
                      'w-3 h-3 rounded-full',
                      config.position === pos.id ? 'bg-[#34B27B]' : 'bg-slate-500'
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Size Selector */}
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2">Size</div>
            <div className="flex gap-2">
              {SIZES.map((size) => (
                <button
                  key={size.id}
                  onClick={() => onConfigChange({ size: size.id })}
                  className={cn(
                    'flex-1 py-2 rounded-lg border transition-all text-xs font-medium',
                    config.size === size.id
                      ? 'border-[#34B27B] bg-[#34B27B]/20 text-[#34B27B]'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                  )}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

### Step 2: Update SettingsPanel Props

Add to `SettingsPanel.tsx` props:

```typescript
interface SettingsPanelProps {
  // ... existing props
  cameraVideoPath?: string | null;
  cameraPipConfig?: CameraPipConfig;
  onCameraPipConfigChange?: (config: Partial<CameraPipConfig>) => void;
}
```

### Step 3: Integrate in SettingsPanel

Add to `SettingsPanel.tsx` render (after zoom section, before wallpaper tabs):

```typescript
import { CameraPipSettings } from './CameraPipSettings';

// In component body:
{cameraVideoPath && cameraPipConfig && onCameraPipConfigChange && (
  <CameraPipSettings
    config={cameraPipConfig}
    onConfigChange={onCameraPipConfigChange}
  />
)}
```

### Step 4: Add Handler in VideoEditor

Add to `VideoEditor.tsx`:

```typescript
const handleCameraPipConfigChange = useCallback((updates: Partial<CameraPipConfig>) => {
  setCameraPipConfig((prev) => ({ ...prev, ...updates }));
}, []);

// Pass to SettingsPanel
<SettingsPanel
  // ... existing props
  cameraVideoPath={cameraVideoPath}
  cameraPipConfig={cameraPipConfig}
  onCameraPipConfigChange={handleCameraPipConfigChange}
/>
```

## Todo List

- [x] Create CameraPipSettings.tsx component
- [x] Add props to SettingsPanel interface
- [x] Integrate CameraPipSettings in SettingsPanel
- [x] Add handler in VideoEditor
- [x] Pass props from VideoEditor to SettingsPanel
- [x] Test position changes update preview
- [x] Test size changes update preview
- [x] Test enable/disable toggle
- [x] Test controls hidden when no camera video

## Success Criteria

1. Camera PiP settings section visible when camera video exists
2. Position selector shows visual 2x2 grid
3. Clicking position updates preview immediately
4. Size selector shows 3 options
5. Clicking size updates preview immediately
6. Enable toggle shows/hides PiP in preview
7. Styling consistent with rest of SettingsPanel

## UI Mockup

```
┌─────────────────────────────────┐
│ Camera PiP                      │
│ ├─────────────────────────────┤│
│ │ Show Camera         [Toggle]││
│ ├─────────────────────────────┤│
│ │ Position                    ││
│ │ ┌────┬────┐                 ││
│ │ │ TL │ TR │                 ││
│ │ ├────┼────┤                 ││
│ │ │ BL │*BR*│  <- selected    ││
│ │ └────┴────┘                 ││
│ ├─────────────────────────────┤│
│ │ Size                        ││
│ │ [S] [*M*] [L]   <- selected ││
│ └─────────────────────────────┘│
└─────────────────────────────────┘
```

## Next Steps

Phase 4 will add export compositing to render the camera PiP into final MP4/GIF exports.
