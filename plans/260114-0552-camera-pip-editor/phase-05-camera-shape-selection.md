# Phase 5: Camera Shape Selection

## Context

- Parent: [Camera PiP Plan](./plan.md)
- Dependencies: Phase 1-4 completed
- Related: [types.ts](../../src/components/video-editor/types.ts), [CameraSettings.tsx](../../src/components/video-editor/CameraSettings.tsx)

## Overview

- **Date**: 2026-01-14
- **Priority**: P2
- **Status**: completed (revised)
- **Completed**: 2026-01-14
- **Effort**: 1.5h
- **Reviews**:
  - [code-reviewer-260114-0856-phase5-camera-shape-selection.md](../reports/code-reviewer-260114-0856-phase5-camera-shape-selection.md)
  - [code-reviewer-260114-0952-phase5-revision-camera-shape.md](../reports/code-reviewer-260114-0952-phase5-revision-camera-shape.md)

**REVISED DESIGN** - Simplified from 4 shapes to 3 shapes with universal borderRadius control:
- **Rectangle** (default): Original aspect ratio, configurable borderRadius (0-50%)
- **Square**: 1:1 aspect ratio, configurable borderRadius (0-50%)
- **Circle**: 1:1 aspect ratio, borderRadius fixed at 50%

**Revision Rationale**:
- Eliminated redundant `rounded-rectangle` shape
- Made borderRadius a universal control for rectangle/square instead of shape-specific
- More intuitive UX: pick shape, then adjust rounding (if applicable)
- Reduced UI complexity: 3-column grid instead of 4
- Changed default borderRadius from 50% to 20% for subtler rounding

## Key Insights

- Current `borderRadius` field (0-100%) already controls corner rounding
- Shape affects both aspect ratio AND border radius
- Rectangle shapes keep original camera aspect ratio
- Square/Circle force 1:1 aspect ratio (crop to center square)
- Only "Rounded Rectangle" needs the borderRadius slider; others have fixed values

## Requirements

### Functional
- Shape selector UI (button group or dropdown)
- Shape affects preview in VideoPlayback
- Shape affects exported video/GIF
- Rounded Rectangle shows borderRadius slider; others hide it

### Non-functional
- Smooth transitions when switching shapes
- No performance regression

## Architecture

```
CameraPipConfig
├── shape: CameraPipShape (new)
├── position: CameraPipPosition
├── size: CameraPipSize
└── borderRadius: number (used for rectangle/square, circle always 50%)

CameraPipShape = 'rectangle' | 'square' | 'circle'
```

**Shape to Rendering Logic (REVISED):**
| Shape | Aspect Ratio | Border Radius | Slider Visible |
|-------|--------------|---------------|----------------|
| rectangle | Original | configurable (0-50%) | Yes |
| square | 1:1 | configurable (0-50%) | Yes |
| circle | 1:1 | 50% (fixed) | No |

## Related Code Files

**Modify:**
- `src/components/video-editor/types.ts` - Add CameraPipShape type
- `src/components/video-editor/CameraSettings.tsx` - Add shape selector UI
- `src/components/video-editor/VideoPlayback.tsx` - Apply shape in preview
- `src/lib/exporter/camera-pip-renderer.ts` - Apply shape in export

## Implementation Steps

### Step 1: Update Types (types.ts) - REVISED
```typescript
export type CameraPipShape = 'rectangle' | 'square' | 'circle';

export interface CameraPipConfig {
  enabled: boolean;
  shape: CameraPipShape; // NEW
  position: CameraPipPosition;
  size: CameraPipSize;
  borderRadius: number; // used for rectangle/square (circle always 50%)
}

export const DEFAULT_CAMERA_PIP_CONFIG: CameraPipConfig = {
  enabled: true,
  shape: 'rectangle', // NEW - changed from 'rounded-rectangle'
  position: 'bottom-right',
  size: 'medium',
  borderRadius: 20, // REVISED - changed from 50 for subtler default
};
```

### Step 2: Update CameraPipSettings.tsx - REVISED
- Add shape selector (3 buttons with icons) in 3-column grid
- Show borderRadius slider when shape != 'circle'
- Icons: RectangleHorizontal, Square, Circle (from lucide-react)

### Step 3: Update CameraPipOverlay.tsx - REVISED
- Helper function: `getShapeStyles(shape, borderRadius)` returns:
  - `borderRadius` CSS value (uses configurable for rect/square, '50%' for circle)
  - `forceSquare` boolean (true for square/circle)
- Apply to camera PiP overlay element with dynamic borderRadius

### Step 4: Update camera-pip-renderer.ts - REVISED
- Helper function: `getShapeParams(shape, borderRadius)` returns:
  - `radius` for roundRect (uses configurable for rect/square, 50 for circle)
  - `forceSquare` boolean for 1:1 crop (true for square/circle)
- Update `render()` to handle all shapes with configurable rounding

## Todo List

- [x] Add CameraPipShape type to types.ts (revised to 3 shapes)
- [x] Update CameraPipConfig interface
- [x] Update DEFAULT_CAMERA_PIP_CONFIG (shape='rectangle', borderRadius=20)
- [x] Add shape selector UI in CameraPipSettings.tsx (3-column grid)
- [x] Conditionally show borderRadius slider (hide for circle only)
- [x] Update preview rendering in CameraPipOverlay.tsx
- [x] Update export rendering in camera-pip-renderer.ts
- [x] Update plan documentation to reflect revision
- [ ] Test all 3 shapes in preview (manual testing required)
- [ ] Test all 3 shapes with borderRadius variations (manual testing required)
- [ ] Test all 3 shapes in MP4 export (manual testing required)
- [ ] Test all 3 shapes in GIF export (manual testing required)

## Success Criteria

1. Shape selector visible in camera settings (3 shapes in 3-column grid)
2. All 3 shapes render correctly in preview
3. All 3 shapes export correctly to MP4/GIF
4. BorderRadius slider visible for Rectangle/Square, hidden for Circle
5. Square/Circle maintain 1:1 aspect ratio
6. Rectangle/Square accept borderRadius 0-50% smoothly
7. Circle always renders as perfect circle (50% rounding) regardless of slider

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Aspect ratio cropping issues | Medium | Center-crop for square/circle |
| Performance with aspect ratio changes | Low | Use CSS object-fit for preview |

## Security Considerations

None - UI-only feature, no new data flows.

## Next Steps

After completion:
- Consider adding custom aspect ratio option
- Consider shape animation transitions
