# Phase 5: Camera Shape Selection

## Context

- Parent: [Camera PiP Plan](./plan.md)
- Dependencies: Phase 1-4 completed
- Related: [types.ts](../../src/components/video-editor/types.ts), [CameraSettings.tsx](../../src/components/video-editor/CameraSettings.tsx)

## Overview

- **Date**: 2026-01-14
- **Priority**: P2
- **Status**: completed
- **Completed**: 2026-01-14
- **Effort**: 1.5h
- **Review**: [code-reviewer-260114-0856-phase5-camera-shape-selection.md](../reports/code-reviewer-260114-0856-phase5-camera-shape-selection.md)

Add shape selection for camera PiP display with 4 options:
- **Rounded Rectangle** (default): Original aspect ratio, configurable borderRadius slider
- **Rectangle**: Original aspect ratio, borderRadius = 0
- **Square**: 1:1 aspect ratio, borderRadius = 0
- **Circle**: 1:1 aspect ratio, borderRadius = 50%

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
└── borderRadius: number (only used when shape = 'rounded-rectangle')

CameraPipShape = 'rounded-rectangle' | 'rectangle' | 'square' | 'circle'
```

**Shape to Rendering Logic:**
| Shape | Aspect Ratio | Border Radius |
|-------|--------------|---------------|
| rounded-rectangle | Original | configurable (0-100) |
| rectangle | Original | 0 |
| square | 1:1 | 0 |
| circle | 1:1 | 50% (full circle) |

## Related Code Files

**Modify:**
- `src/components/video-editor/types.ts` - Add CameraPipShape type
- `src/components/video-editor/CameraSettings.tsx` - Add shape selector UI
- `src/components/video-editor/VideoPlayback.tsx` - Apply shape in preview
- `src/lib/exporter/camera-pip-renderer.ts` - Apply shape in export

## Implementation Steps

### Step 1: Update Types (types.ts)
```typescript
export type CameraPipShape = 'rounded-rectangle' | 'rectangle' | 'square' | 'circle';

export interface CameraPipConfig {
  enabled: boolean;
  shape: CameraPipShape; // NEW
  position: CameraPipPosition;
  size: CameraPipSize;
  borderRadius: number;
}

export const DEFAULT_CAMERA_PIP_CONFIG: CameraPipConfig = {
  enabled: true,
  shape: 'rounded-rectangle', // NEW
  position: 'bottom-right',
  size: 'medium',
  borderRadius: 50,
};
```

### Step 2: Update CameraSettings.tsx
- Add shape selector (4 buttons with icons)
- Show borderRadius slider only when shape = 'rounded-rectangle'
- Icons: rounded-rect, rect, square, circle

### Step 3: Update VideoPlayback.tsx
- Helper function: `getShapeStyles(shape, borderRadius)` returns:
  - `borderRadius` CSS value
  - `aspectRatio` for container (or '1' for square/circle)
- Apply to camera PiP overlay element

### Step 4: Update camera-pip-renderer.ts
- Helper function: `getShapeParams(shape, borderRadius)` returns:
  - `radius` for roundRect
  - `forceSquare` boolean for 1:1 crop
- Update `render()` to handle square/circle aspect ratio

## Todo List

- [x] Add CameraPipShape type to types.ts
- [x] Update CameraPipConfig interface
- [x] Update DEFAULT_CAMERA_PIP_CONFIG
- [x] Add shape selector UI in CameraSettings.tsx (actually CameraPipSettings.tsx)
- [x] Conditionally show borderRadius slider
- [x] Update preview rendering in CameraPipOverlay.tsx
- [x] Update export rendering in camera-pip-renderer.ts
- [ ] Fix ESLint warning in VideoEditor.tsx (unnecessary dependency)
- [ ] Test all 4 shapes in preview (manual testing required)
- [ ] Test all 4 shapes in MP4 export (manual testing required)
- [ ] Test all 4 shapes in GIF export (manual testing required)

## Success Criteria

1. Shape selector visible in camera settings
2. All 4 shapes render correctly in preview
3. All 4 shapes export correctly to MP4/GIF
4. BorderRadius slider only visible for Rounded Rectangle
5. Square/Circle maintain 1:1 aspect ratio

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
