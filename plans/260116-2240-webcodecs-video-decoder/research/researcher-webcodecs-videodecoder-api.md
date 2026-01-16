# WebCodecs VideoDecoder API - Research Report

**Date:** 2026-01-16
**Status:** Complete
**Focus:** Practical implementation for video frame extraction

---

## 1. VideoDecoder API Basics

### Constructor & Initialization
```javascript
const decoder = new VideoDecoder(outputCallback, errorCallback);
```
- **outputCallback**: Called with each decoded VideoFrame
- **errorCallback**: Called on decode errors

### Key Properties
- `state`: 'unconfigured' | 'configured' | 'closed'
- `decodeQueueSize`: Number of pending decode requests (read-only)
- `dequeue` event: Fires when queue size decreases

### Configuration
```javascript
// Feature detection (always do this first)
const support = await VideoDecoder.isConfigSupported({
  codec: 'vp9',
  codedHeight: 1080,
  codedWidth: 1920,
});

// Configure if supported
if (support.supported) {
  decoder.configure(support.config);
}
```

### Decode Flow
```javascript
// Create EncodedVideoChunk with required properties:
const chunk = new EncodedVideoChunk({
  type: 'key' | 'delta',  // Frame type
  timestamp: microseconds, // Use consistent units
  data: arrayBuffer        // Encoded data
});

decoder.decode(chunk);
await decoder.flush(); // Wait for all pending decodes
```

---

## 2. Hardware Acceleration & Configuration

### Hardware Preference Strategy
Hardware acceleration is implicit in VideoDecoder—no explicit `prefer-hardware` flag exists. Instead:
- Chromium uses **system codec libraries** when available (VA-API on Linux, VideoToolbox on macOS, Media Foundation on Windows)
- Electron requires build flags: `proprietary_codecs=true ffmpeg_branding="Chrome"`
- HEVC support on Electron ≥33.0.0 includes HW acceleration for macOS/Windows

### Practical Approach
```javascript
// Use codec inspection to verify acceleration potential
const config = {
  codec: 'avc1.42001E', // H.264 (good HW support)
  // codec: 'hev1.1.6.L93.B0', // HEVC (newer HW support)
  codedHeight: 1080,
  codedWidth: 1920,
};
```

**Note:** WebCodecs automatically leverages hardware decoders when available. No explicit configuration needed.

---

## 3. Decode Queue Management & Backpressure

### Monitor Queue Size
```javascript
decoder.addEventListener('dequeue', () => {
  console.log(`Queue size: ${decoder.decodeQueueSize}`);
});

// Manual check before feeding data
if (decoder.decodeQueueSize < maxQueueSize) {
  decoder.decode(chunk);
} else {
  // Apply backpressure: pause feeding until dequeue fires
}
```

### Queue Pressure Pattern
- **High Queue**: Input exceeds decode speed → pause chunk feeding
- **Low Queue**: Decoder ready → resume chunk feeding
- **Asynchronous**: Decode ops run off-main-thread; monitor `decodeQueueSize` to prevent stalling

### Best Practice
Use `ReadableStream` + `MediaStreamTrackProcessor` for automatic backpressure handling in pipelines.

---

## 4. VideoFrame Lifecycle & Memory Management

### Critical: Manual Cleanup Required
```javascript
const outputCallback = (frame) => {
  // Process frame
  processFrame(frame);

  // MUST call close() to release GPU memory immediately
  // Don't rely on garbage collection
  frame.close();
};
```

### Frame Cloning (Efficient)
```javascript
// Cloning shares underlying resources (no copy)
const clonedFrame = frame.clone();
// Both reference same data; close both when done
```

### Copy Minimization
- **copyTo()**: Explicit CPU-side ArrayBuffer copy (expensive)
- **clone()**: Shares GPU resources (efficient)
- **CanvasImageSource**: Use `drawImage()` or `texImage2D()` without copies when possible

### GPU-CPU Transfer Cost
Avoid excessive reads (readback) or texture uploads. Prefer:
1. Keep frames on GPU when possible
2. Use `canvas.drawImage(frame)` for rendering
3. Use WebGPU `texImage2D(frame)` for compute

---

## 5. Browser & Electron Compatibility

### Browser Support Matrix (as of 2026)
| Browser | VideoDecoder | AudioDecoder |
|---------|--------------|--------------|
| Chrome/Edge | ✅ Yes | ✅ Yes |
| Firefox | ❌ No | ❌ No |
| Safari | ✅ Yes | 🔄 Preview |

### Electron Specifics
- **Standard builds**: No proprietary codec support by default
- **Custom builds**: Requires `proprietary_codecs=true ffmpeg_branding="Chrome"`
- **HEVC**: Electron ≥33.0.0 includes HW acceleration
- **Fallback strategy**: Detect unsupported codecs; use FFmpeg or canvas fallbacks

### Detection Pattern
```javascript
async function supportsCodec(codec) {
  try {
    const support = await VideoDecoder.isConfigSupported({ codec });
    return support.supported;
  } catch {
    return false; // API not available or codec unsupported
  }
}
```

---

## 6. Implementation Best Practices

### Setup Pattern
1. **Feature detection** → `isConfigSupported()`
2. **Configure** → `decoder.configure()`
3. **Monitor queue** → Check `decodeQueueSize`
4. **Cleanup frames** → `frame.close()` in callback
5. **Finalize** → `decoder.flush()` then `decoder.close()`

### Performance Optimization
- Use **Web Workers** to offload decode processing
- Monitor `decodeQueueSize` to apply backpressure
- Call `frame.close()` immediately after use (don't batch)
- Batch-check `isConfigSupported()` before processing starts
- Use ChromeDevTools Media Panel for debugging

### Error Handling
```javascript
const errorCallback = (error) => {
  console.error('Decode error:', error.message);
  // Don't assume decoder is still usable; reset if needed
  decoder.reset();
};
```

### Queue Saturation Protection
```javascript
const maxQueueSize = 4; // Tune per hardware capability

function feedChunk(chunk) {
  if (decoder.decodeQueueSize < maxQueueSize) {
    decoder.decode(chunk);
    return true;
  }
  return false; // Backpressure signal
}
```

---

## Key Takeaways

✅ **VideoDecoder** provides native hardware-accelerated decoding
✅ **Async-first design**: Decode ops never block main thread
✅ **Manual memory mgmt**: Call `frame.close()` immediately
✅ **Backpressure critical**: Monitor `decodeQueueSize` to prevent stalling
✅ **Hardware implicit**: No config flag needed; system codecs used automatically
✅ **Electron limitation**: Proprietary codecs require custom build flags

---

## Unresolved Questions

1. **Exact hardware acceleration detection**: Is there a way to programmatically verify if HW acceleration is active vs software fallback?
2. **Electron codec build defaults**: Do newer Electron versions enable proprietary codecs by default?
3. **Queue size heuristics**: What's optimal `maxQueueSize` for different hardware profiles?
4. **ReconfigurableCodecs**: Which codecs support mid-stream reconfiguration without reset?

---

## Sources
- [MDN VideoDecoder API](https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder)
- [Chrome WebCodecs Best Practices](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [W3C WebCodecs Explainer](https://github.com/w3c/webcodecs/blob/main/explainer.md)
- [Can I Use WebCodecs](https://caniuse.com/webcodecs)
- [WebRTC Hacks: Real-Time Video Processing](https://webrtchacks.com/real-time-video-processing-with-webcodecs-and-streams-processing-pipelines-part-1/)
- [Remotion WebCodecs Guide](https://www.remotion.dev/docs/webcodecs/)
