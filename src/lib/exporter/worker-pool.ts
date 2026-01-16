/**
 * Worker pool manager for parallel frame rendering.
 * Spawns 4 Web Workers (fixed count per validation) and manages their lifecycle.
 *
 * Key features:
 * - Fixed pool of 4 workers (optimal for M4, avoids contention)
 * - Tracks busy/idle state per worker
 * - Handles worker crashes with error propagation
 * - Graceful shutdown with cleanup
 */

import type { WorkerRenderConfig, WorkerToMainMessage } from './workers/worker-types';

/** Default number of workers (validated: 4 is optimal for M4) */
const DEFAULT_WORKER_COUNT = 4;

interface WorkerState {
  worker: Worker;
  workerId: number;
  busy: boolean;
  canvas: OffscreenCanvas | null;
  onIdle: (() => void) | null;
}

export interface WorkerPoolConfig {
  /** Number of workers to spawn. Default: 4 */
  workerCount?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

export interface WorkerPoolStats {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  framesRendered: number;
  errors: number;
}

type MessageHandler = (workerId: number, message: WorkerToMainMessage) => void;

export class WorkerPool {
  private workers: WorkerState[] = [];
  private readonly workerCount: number;
  private readonly debug: boolean;
  private isInitialized = false;
  private messageHandler: MessageHandler | null = null;
  private framesRendered = 0;
  private errorCount = 0;

  constructor(config: WorkerPoolConfig = {}) {
    // Use 4 workers (validated optimal for M4)
    this.workerCount = config.workerCount ?? DEFAULT_WORKER_COUNT;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize worker pool with render config.
   * Creates workers and sends init message with OffscreenCanvas.
   */
  async initialize(renderConfig: WorkerRenderConfig): Promise<void> {
    if (this.isInitialized) {
      throw new Error('WorkerPool already initialized');
    }

    // Use Vite's worker import pattern for proper bundling
    // The ?worker&url suffix tells Vite to bundle the worker and return its URL
    const workerUrl = new URL('./workers/render-worker.ts', import.meta.url);

    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < this.workerCount; i++) {
      const canvas = new OffscreenCanvas(renderConfig.width, renderConfig.height);
      const worker = new Worker(workerUrl, { type: 'module' });

      const state: WorkerState = {
        worker,
        workerId: i,
        busy: false,
        canvas,
        onIdle: null,
      };

      // Setup message handling
      worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
        this.handleWorkerMessage(state, e.data);
      };

      worker.onerror = (e) => {
        console.error(`[WorkerPool] Worker ${i} error:`, e);
        this.errorCount++;
        state.busy = false;
        // Resolve any waiting promises to prevent deadlock
        if (state.onIdle) {
          state.onIdle();
          state.onIdle = null;
        }
      };

      this.workers.push(state);

      // Send init message with transferred canvas
      const initPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Worker ${i} init timeout`));
        }, 10000);

        const originalHandler = worker.onmessage;
        worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
          if (e.data.type === 'ready') {
            clearTimeout(timeout);
            worker.onmessage = originalHandler;
            if (this.debug) {
              console.log(`[WorkerPool] Worker ${i} ready`);
            }
            resolve();
          } else if (e.data.type === 'error') {
            clearTimeout(timeout);
            worker.onmessage = originalHandler;
            reject(new Error(e.data.error));
          }
        };
      });

      worker.postMessage(
        {
          type: 'init',
          workerId: i,
          config: renderConfig,
          canvas,
        },
        [canvas]
      );

      initPromises.push(initPromise);
    }

    await Promise.all(initPromises);
    this.isInitialized = true;

    if (this.debug) {
      console.log(`[WorkerPool] Initialized ${this.workerCount} workers`);
    }
  }

  /**
   * Set handler for worker messages (rendered frames, errors).
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  private handleWorkerMessage(state: WorkerState, message: WorkerToMainMessage): void {
    if (message.type === 'rendered') {
      this.framesRendered++;
      state.busy = false;

      // Notify if something is waiting for this worker
      if (state.onIdle) {
        state.onIdle();
        state.onIdle = null;
      }
    } else if (message.type === 'error') {
      this.errorCount++;
      state.busy = false;

      if (state.onIdle) {
        state.onIdle();
        state.onIdle = null;
      }
    }

    // Forward to external handler
    if (this.messageHandler) {
      this.messageHandler(state.workerId, message);
    }
  }

  /**
   * Get an idle worker, or null if all busy.
   */
  getIdleWorker(): WorkerState | null {
    return this.workers.find(w => !w.busy) ?? null;
  }

  /**
   * Wait for any worker to become idle.
   */
  async waitForIdleWorker(): Promise<WorkerState> {
    const idle = this.getIdleWorker();
    if (idle) return idle;

    // Wait for first worker to become idle
    return new Promise((resolve) => {
      const checkIdle = () => {
        const idleWorker = this.getIdleWorker();
        if (idleWorker) {
          resolve(idleWorker);
          return;
        }
        // Register callback on all busy workers
        for (const state of this.workers) {
          if (state.busy && !state.onIdle) {
            state.onIdle = checkIdle;
          }
        }
      };
      checkIdle();
    });
  }

  /**
   * Submit a render task to a specific worker.
   * @param worker - Worker state from getIdleWorker/waitForIdleWorker
   * @param frameIndex - Frame sequence number for reassembly
   * @param videoFrame - VideoFrame to render (will be transferred)
   * @param timestamp - Frame timestamp in microseconds
   */
  submitRenderTask(
    worker: WorkerState,
    frameIndex: number,
    videoFrame: VideoFrame,
    timestamp: number
  ): void {
    if (!this.isInitialized) {
      throw new Error('WorkerPool not initialized');
    }

    worker.busy = true;
    worker.worker.postMessage(
      {
        type: 'render',
        frameIndex,
        videoFrame,
        timestamp,
      },
      [videoFrame]
    );
  }

  /**
   * Check if pool is ready to accept work.
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get number of currently busy workers.
   */
  getBusyCount(): number {
    return this.workers.filter(w => w.busy).length;
  }

  /**
   * Get pool statistics.
   */
  getStats(): WorkerPoolStats {
    const busyWorkers = this.getBusyCount();
    return {
      totalWorkers: this.workerCount,
      busyWorkers,
      idleWorkers: this.workerCount - busyWorkers,
      framesRendered: this.framesRendered,
      errors: this.errorCount,
    };
  }

  /**
   * Shutdown all workers gracefully.
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    const shutdownPromises = this.workers.map((state) => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn(`[WorkerPool] Worker ${state.workerId} shutdown timeout, terminating`);
          state.worker.terminate();
          resolve();
        }, 5000);

        state.worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
          if (e.data.type === 'shutdown_complete') {
            clearTimeout(timeout);
            resolve();
          }
        };

        state.worker.postMessage({ type: 'shutdown' });
      });
    });

    await Promise.all(shutdownPromises);

    this.workers = [];
    this.isInitialized = false;
    this.messageHandler = null;

    if (this.debug) {
      console.log('[WorkerPool] All workers shut down');
    }
  }

  /**
   * Forcefully terminate all workers (for error recovery).
   */
  terminate(): void {
    for (const state of this.workers) {
      state.worker.terminate();
    }
    this.workers = [];
    this.isInitialized = false;
    this.messageHandler = null;
  }
}
