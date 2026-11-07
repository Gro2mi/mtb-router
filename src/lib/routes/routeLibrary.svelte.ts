/**
 * Route library UI orchestration (E6.1/E6.2): bridges the reactive planning
 * + waypoint stores with the persisted route records and GPX delivery.
 */
import { i18n } from '../i18n.svelte';
import { toast } from '../state/toast.svelte';
import { planning } from '../state/planning.svelte';
import { waypoints } from '../waypoints/store.svelte';
import { currentViewport, flyToViewport } from '../map/viewportAccess';
import { saveRiderSettings } from '../state/settingsPersist';
import { deleteRoute, duplicateRoute, getRoute, listRoutes, saveRoute } from './routeStore';
import { storedToWaypoints, toStoredRoute, type StoredRoute } from './serialization';
import { buildGpx, type GpxWaypoint } from '../gpx/gpx';
import { deliverGpx } from '../gpx/download';

class RouteLibrary {
  routes = $state<StoredRoute[]>([]);
  busy = $state(false);

  async refresh(): Promise<void> {
    this.routes = await listRoutes();
  }

  /** Persist the current planning state under `name`. */
  async saveCurrent(name: string): Promise<boolean> {
    // $state.snapshot first: the stores hand out reactive proxies and
    // structuredClone (inside toStoredRoute / the IDB put) cannot clone them
    const route = planning.route ? $state.snapshot(planning.route) : null;
    const settings = $state.snapshot(planning.settings);
    const wps = waypoints.waypoints.map(
      (wp) => $state.snapshot(wp) as import('../waypoints/store.svelte').Waypoint,
    );
    if (!route || wps.length < 2) return false;
    const trimmed = name.trim() || defaultName();
    this.busy = true;
    try {
      await saveRoute(
        toStoredRoute({
          id: newId(),
          name: trimmed,
          waypoints: wps,
          settings,
          route,
          viewport: currentViewport(),
        }),
      );
      saveRiderSettings(settings);
      await this.refresh();
      toast(i18n.m.route_saved({ name: trimmed }));
      return true;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Restore a saved route: settings first (no reroute), then waypoints —
   * the App waypoint effect replans through the normal pipeline; the saved
   * geometry is seeded for instant display.
   */
  async load(id: string): Promise<void> {
    this.busy = true;
    try {
      const stored = (await getRoute(id)) ?? this.routes.find((r) => r.id === id);
      if (!stored) return;
      // snapshot: the list fallback hands out deep proxies (structuredClone
      // would throw on them); restoreSettings/restore already deep-copy
      const plain = $state.snapshot(stored) as StoredRoute;
      planning.restoreSettings(plain.settings);
      waypoints.restore(storedToWaypoints(plain));
      planning.route = plain.route ? structuredClone(plain.route) : null;
      planning.phase = 'ready';
      planning.errorCode = null;
      if (stored.viewport) flyToViewport(stored.viewport);
      toast(i18n.m.route_loaded({ name: stored.name }));
    } finally {
      this.busy = false;
    }
  }

  async remove(id: string): Promise<void> {
    await deleteRoute(id);
    await this.refresh();
  }

  async duplicate(id: string): Promise<void> {
    await duplicateRoute(id);
    await this.refresh();
  }

  async rename(id: string, name: string): Promise<void> {
    const existing = this.routes.find((r) => r.id === id);
    if (!existing || name.trim() === '') return;
    await saveRoute({ ...existing, name: name.trim(), updatedAt: Date.now() });
    await this.refresh();
  }

  /** Export a saved record as GPX from the list. */
  async exportSaved(id: string): Promise<void> {
    const stored = this.routes.find((r) => r.id === id);
    if (!stored || !stored.route) return;
    const wps: GpxWaypoint[] = stored.waypoints.map((wp, i) => ({
      lat: wp.snap ? wp.snap.lat : wp.rawLat,
      lon: wp.snap ? wp.snap.lng : wp.rawLng,
      name: `Waypoint ${i + 1}`,
    }));
    await deliverGpx(
      buildGpx({ name: stored.name, route: stored.route, waypoints: wps }),
      stored.name,
    );
  }
}

function defaultName(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const routeLibrary = new RouteLibrary();
