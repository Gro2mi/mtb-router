/**
 * Main-thread host for the engine worker (E3.1): typed request methods and
 * event callbacks. One worker per app; the host is a module singleton via
 * `getEngineHost()`.
 */
import type {
  EngineStage,
  HostToWorker,
  RiderSettings,
  WorkerErrorCode,
  WorkerToHost,
} from './protocol';
import type { SnapResult } from '../lib/osm/snapIndex';

export interface EngineCallbacks {
  onProgress?(stage: EngineStage): void;
  onReady?(snaps: (SnapResult | null)[], radiusM: number): void;
  onRoute?(route: import('./protocol').RouteResult): void;
  onWidening?(): void;
  onError?(code: WorkerErrorCode): void;
}

export class EngineHost {
  private readonly worker: Worker;
  private msgId = 0;
  private probeResolvers: ((snap: SnapResult | null) => void)[] = [];
  private cb: EngineCallbacks;

  constructor(cb: EngineCallbacks) {
    this.cb = cb;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerToHost>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'progress':
          this.cb.onProgress?.(msg.stage);
          break;
        case 'ready':
          this.cb.onReady?.(msg.snaps, msg.radiusM);
          break;
        case 'route':
          this.cb.onRoute?.(msg.route);
          break;
        case 'widening':
          this.cb.onWidening?.();
          break;
        case 'error':
          this.cb.onError?.(msg.code);
          break;
        case 'snapProbeResult': {
          const resolve = this.probeResolvers.shift();
          resolve?.(msg.snap);
          break;
        }
      }
    };
    this.worker.onerror = () => {
      this.cb.onError?.('corridor');
    };
  }

  plan(
    points: [number, number][],
    settings: RiderSettings,
    tileBaseUrl: string | null,
    snapRadiusM: number,
  ): void {
    this.send({ id: ++this.msgId, type: 'plan', points, settings, tileBaseUrl, snapRadiusM });
  }

  reroute(settings: RiderSettings): void {
    this.send({ id: ++this.msgId, type: 'reroute', settings });
  }

  setSnapRadius(snapRadiusM: number): void {
    this.send({ id: ++this.msgId, type: 'setSnapRadius', snapRadiusM });
  }

  /** fire-and-forget drag probe; resolves with the nearest way within 150 m */
  snapProbe(lng: number, lat: number): Promise<SnapResult | null> {
    return new Promise((resolve) => {
      this.probeResolvers.push(resolve);
      this.send({ id: ++this.msgId, type: 'snapProbe', lng, lat });
    });
  }

  cancel(): void {
    this.send({ type: 'cancel' });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private send(msg: HostToWorker): void {
    this.worker.postMessage(msg);
  }

  updateCallbacks(cb: EngineCallbacks): void {
    this.cb = cb;
  }
}

let singleton: EngineHost | undefined;

export function getEngineHost(cb: EngineCallbacks): EngineHost {
  if (!singleton) singleton = new EngineHost(cb);
  else singleton.updateCallbacks(cb);
  return singleton;
}

/** test/HMR hook */
export function resetEngineHost(): void {
  singleton?.dispose();
  singleton = undefined;
}
