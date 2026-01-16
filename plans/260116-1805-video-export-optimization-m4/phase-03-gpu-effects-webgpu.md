# Phase 3: GPU Effects via WebGPU

## Context Links

- [Phase 2: Parallel Rendering](./phase-02-parallel-rendering-workers.md)
- [Current FrameRenderer](../src/lib/exporter/frameRenderer.ts) - see compositeWithShadows()
- [WebGPU Spec](https://www.w3.org/TR/webgpu/)
- [WGSL Spec](https://www.w3.org/TR/WGSL/)

## Overview

| Field | Value |
|-------|-------|
| Priority | P2 - Enhancement |
| Status | pending |
| Effort | 4h |
| Impact | 2-3x additional speedup |

Replace CPU-bound canvas filter operations (blur, shadow) with WebGPU compute shaders. Direct GPU → Encoder pipeline avoids CPU round-trip for final frame.

## Key Insights

1. **Current bottleneck**: `ctx.filter = 'blur(6px)'` and `drop-shadow()` are CPU-bound
2. **M4 GPU**: Dedicated Media Engine + powerful GPU, underutilized (<20%)
3. **WebGPU in Electron**: Supported via Chrome's implementation
4. **Metal backend**: M4 uses Metal for WebGPU; optimal for Apple Silicon
5. **Direct GPU output**: VideoFrame can be created from GPU texture (no readback)

## Requirements

### Functional Requirements

- [ ] WebGPU-based Gaussian blur shader
- [ ] WebGPU-based multi-layer shadow shader
- [ ] GPU texture → VideoFrame pipeline (no CPU readback)
- [ ] Feature detection with canvas filter fallback
- [ ] Configurable effect parameters (blur radius, shadow intensity)

### Non-Functional Requirements

- [ ] Reduce effect rendering from 10-20ms to 1-3ms
- [ ] GPU memory bounded (release textures promptly)
- [ ] Works in Electron on M4 Macs
- [ ] Graceful fallback on non-WebGPU browsers

## Architecture

### Current Effect Pipeline (CPU-bound)

```
[PixiJS Canvas] → [Shadow Canvas ctx.filter='drop-shadow()'] → [Composite Canvas]
                       ↓ (CPU blur, CPU alpha composite)
                  [~15-25ms per frame on M4]
```

### Optimized Pipeline (GPU-accelerated)

```
[PixiJS Canvas] → [GPU Texture] → [WebGPU Blur Shader] → [GPU Texture]
                                          ↓
[Background Tex] → [GPU Texture] → [WebGPU Shadow Shader] → [GPU Texture]
                                          ↓
                              [WebGPU Composite] → [GPU Texture]
                                          ↓
                              [VideoFrame.copyTo()] → [Encoder]
                              (zero-copy if supported)

                  [~1-3ms per frame on M4]
```

### WebGPU Pipeline Structure

```typescript
interface GPUEffectsPipeline {
  device: GPUDevice;
  blurPipeline: GPUComputePipeline;
  shadowPipeline: GPUComputePipeline;
  compositePipeline: GPUComputePipeline;

  // Persistent resources (reused per frame)
  inputTexture: GPUTexture;
  blurTexture: GPUTexture;
  shadowTexture: GPUTexture;
  outputTexture: GPUTexture;

  // Bind groups (updated per frame)
  blurBindGroup: GPUBindGroup;
  shadowBindGroup: GPUBindGroup;
  compositeBindGroup: GPUBindGroup;
}
```

### Gaussian Blur Shader (WGSL)

```wgsl
// blur-shader.wgsl
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: BlurParams;

struct BlurParams {
  radius: f32,
  direction: vec2<f32>,  // (1,0) for horizontal, (0,1) for vertical
  sigma: f32,
}

// Two-pass separable Gaussian blur for O(n) instead of O(n^2)
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(inputTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  var sum = vec4<f32>(0.0);
  var weightSum = 0.0;

  let radius = i32(params.radius);
  for (var i = -radius; i <= radius; i++) {
    let offset = vec2<i32>(i32(params.direction.x) * i, i32(params.direction.y) * i);
    let coord = vec2<i32>(id.xy) + offset;

    if (coord.x >= 0 && coord.x < i32(dims.x) && coord.y >= 0 && coord.y < i32(dims.y)) {
      let weight = exp(-f32(i * i) / (2.0 * params.sigma * params.sigma));
      sum += textureLoad(inputTex, coord, 0) * weight;
      weightSum += weight;
    }
  }

  textureStore(outputTex, id.xy, sum / weightSum);
}
```

### Multi-Layer Shadow Shader (WGSL)

```wgsl
// shadow-shader.wgsl
@group(0) @binding(0) var videoTex: texture_2d<f32>;
@group(0) @binding(1) var backgroundTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params: ShadowParams;

struct ShadowParams {
  intensity: f32,
  offsetY: f32,
  blur1: f32,
  blur2: f32,
  blur3: f32,
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(videoTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }

  let uv = vec2<f32>(id.xy) / vec2<f32>(dims);

  // Sample background
  let bg = textureLoad(backgroundTex, id.xy, 0);

  // Sample video with shadow offset
  let shadowOffset = vec2<i32>(0, i32(params.offsetY));
  let shadowCoord = vec2<i32>(id.xy) - shadowOffset;

  var shadow = vec4<f32>(0.0);
  if (shadowCoord.y >= 0 && shadowCoord.y < i32(dims.y)) {
    let videoAlpha = textureLoad(videoTex, shadowCoord, 0).a;
    // Multi-layer shadow with different intensities
    let shadowAlpha = videoAlpha * params.intensity * 0.7;
    shadow = vec4<f32>(0.0, 0.0, 0.0, shadowAlpha);
  }

  // Composite: background + shadow + video
  let video = textureLoad(videoTex, id.xy, 0);
  var result = bg;
  result = mix(result, shadow, shadow.a);  // Shadow over background
  result = mix(result, video, video.a);     // Video over shadow

  textureStore(outputTex, id.xy, result);
}
```

## Related Code Files

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/exporter/frameRenderer.ts` | Add GPUEffects integration; fallback logic |
| `src/lib/exporter/workers/worker-pixi-renderer.ts` | Use GPUEffects in worker context |

### Files to Create

| File | Purpose | LOC Est |
|------|---------|---------|
| `src/lib/exporter/gpu-effects/gpu-effects-pipeline.ts` | WebGPU setup and pipeline management | 150 |
| `src/lib/exporter/gpu-effects/blur-pass.ts` | Two-pass Gaussian blur | 80 |
| `src/lib/exporter/gpu-effects/shadow-composite-pass.ts` | Shadow + composite | 80 |
| `src/lib/exporter/gpu-effects/shaders/blur.wgsl` | Blur compute shader | 40 |
| `src/lib/exporter/gpu-effects/shaders/shadow-composite.wgsl` | Shadow shader | 60 |
| `src/lib/exporter/gpu-effects/texture-utils.ts` | Canvas ↔ GPU texture helpers | 60 |

## Implementation Steps

### Step 1: WebGPU Feature Detection (0.5h)

1. Create `src/lib/exporter/gpu-effects/gpu-effects-pipeline.ts`
2. Implement `isWebGPUSupported()` check
3. Request adapter with `powerPreference: 'high-performance'`
4. Create device with compute shader support

```typescript
export async function createGPUEffectsPipeline(
  width: number,
  height: number
): Promise<GPUEffectsPipeline | null> {
  if (!navigator.gpu) {
    console.warn('[GPUEffects] WebGPU not available, using fallback');
    return null;
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return null;

  const device = await adapter.requestDevice({
    requiredFeatures: [],
    requiredLimits: {
      maxComputeWorkgroupSizeX: 16,
      maxComputeWorkgroupSizeY: 16,
    },
  });

  return new GPUEffectsPipeline(device, width, height);
}
```

### Step 2: Create Blur Shader (1h)

1. Create `src/lib/exporter/gpu-effects/shaders/blur.wgsl`
2. Implement two-pass separable Gaussian blur
3. Create `blur-pass.ts` wrapper class
4. Test: blur a solid color square, verify gradient edges

### Step 3: Create Shadow Composite Shader (1h)

1. Create `src/lib/exporter/gpu-effects/shaders/shadow-composite.wgsl`
2. Implement multi-layer shadow with alpha compositing
3. Create `shadow-composite-pass.ts` wrapper class
4. Test: shadow offset, intensity parameters

### Step 4: Create Texture Utilities (0.5h)

1. Create `src/lib/exporter/gpu-effects/texture-utils.ts`
2. Implement `canvasToGPUTexture()`
3. Implement `gpuTextureToVideoFrame()` (zero-copy if supported)
4. Handle fallback via `copyExternalImageToTexture`

### Step 5: Integrate into FrameRenderer (1h)

1. Initialize GPUEffects in `frameRenderer.initialize()`
2. Replace `compositeWithShadows()` with GPU pipeline
3. Keep canvas filter fallback when GPUEffects is null
4. Profile: compare GPU vs CPU effect times

## Todo List

- [ ] Create gpu-effects-pipeline.ts with WebGPU setup
- [ ] Create blur.wgsl compute shader
- [ ] Create blur-pass.ts wrapper
- [ ] Create shadow-composite.wgsl shader
- [ ] Create shadow-composite-pass.ts wrapper
- [ ] Create texture-utils.ts (canvas ↔ GPU)
- [ ] Integrate into frameRenderer.ts
- [ ] Add feature detection and fallback
- [ ] Test on M4 Mac
- [ ] Benchmark GPU vs CPU effects
- [ ] Profile GPU memory usage
- [ ] Verify visual parity with canvas filters

## Success Criteria

1. **Performance**: Effect rendering <3ms per frame (down from 15-25ms)
2. **Quality**: Blur/shadow visually identical to canvas filters
3. **Compatibility**: Graceful fallback on non-WebGPU systems
4. **Memory**: GPU textures released promptly; no VRAM leaks
5. **M4 Optimization**: Metal backend utilized (verify via profiler)

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebGPU not available | Low | Medium | Always have canvas filter fallback |
| Shader compilation errors | Medium | Medium | Validate WGSL syntax; test on multiple GPUs |
| Visual differences from canvas | Medium | High | Side-by-side comparison tests |
| GPU memory leaks | Medium | High | Explicit destroy(); track allocations |
| Worker context WebGPU | Medium | Medium | Test OffscreenCanvas + WebGPU interaction |

## Security Considerations

- WebGPU runs in sandboxed GPU process
- Shaders are static (not user-provided)
- Texture data stays in GPU memory; not exposed to JS
- No timing attacks possible from compute shaders

## Next Steps

After Phase 3 completion:
1. Full pipeline benchmark: target 20-40s for 1min 1080p30
2. Test with 4K content (verify scaling)
3. Document optimization findings for future reference
4. Consider HEVC export for smaller files (separate feature)
