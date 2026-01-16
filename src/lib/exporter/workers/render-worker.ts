/**
 * Web Worker entry point for parallel frame rendering.
 * Uses PixiJS 8 WebWorkerAdapter for headless OffscreenCanvas rendering.
 *
 * Message Protocol:
 * - init: Initialize worker with config and OffscreenCanvas
 * - render: Render a single frame and return VideoFrame
 * - shutdown: Clean up resources and close worker
 */

import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import { WorkerPixiRenderer } from './worker-pixi-renderer';
import type { WorkerRenderConfig } from './worker-types';

// Must set WebWorkerAdapter before any PixiJS operations
DOMAdapter.set(WebWorkerAdapter);

let renderer: WorkerPixiRenderer | null = null;
let workerId = -1;

// Type-safe message handlers
interface InitMessage {
  type: 'init';
  workerId: number;
  config: WorkerRenderConfig;
  canvas: OffscreenCanvas;
}

interface RenderMessage {
  type: 'render';
  frameIndex: number;
  videoFrame: VideoFrame;
  timestamp: number;
}

interface ShutdownMessage {
  type: 'shutdown';
}

type WorkerMessage = InitMessage | RenderMessage | ShutdownMessage;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type } = e.data;

  switch (type) {
    case 'init': {
      const { workerId: id, config, canvas } = e.data as InitMessage;
      workerId = id;

      try {
        renderer = new WorkerPixiRenderer(config);
        await renderer.initialize(canvas);
        self.postMessage({ type: 'ready', workerId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ type: 'error', workerId, error: `Init failed: ${message}` });
      }
      break;
    }

    case 'render': {
      const { frameIndex, videoFrame, timestamp } = e.data as RenderMessage;

      if (!renderer) {
        videoFrame.close();
        self.postMessage({
          type: 'error',
          frameIndex,
          workerId,
          error: 'Renderer not initialized',
        });
        break;
      }

      try {
        const renderedFrame = await renderer.renderFrame(videoFrame, timestamp);

        // Transfer the rendered frame back (zero-copy)
        // Use postMessage with transfer list for zero-copy VideoFrame transfer
        (self as unknown as { postMessage(msg: unknown, transfer: Transferable[]): void }).postMessage(
          { type: 'rendered', frameIndex, workerId, renderedFrame },
          [renderedFrame]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({
          type: 'error',
          frameIndex,
          workerId,
          error: `Render failed: ${message}`,
        });
      }
      break;
    }

    case 'shutdown': {
      if (renderer) {
        renderer.destroy();
        renderer = null;
      }
      self.postMessage({ type: 'shutdown_complete', workerId });
      self.close();
      break;
    }

    default:
      console.warn(`[RenderWorker ${workerId}] Unknown message type:`, type);
  }
};

// Handle uncaught errors
self.onerror = (event: string | Event) => {
  console.error(`[RenderWorker ${workerId}] Uncaught error:`, event);
  const errorMessage = typeof event === 'string' ? event : (event as ErrorEvent).message || String(event);
  self.postMessage({
    type: 'error',
    workerId,
    error: `Uncaught error: ${errorMessage}`,
  });
};
