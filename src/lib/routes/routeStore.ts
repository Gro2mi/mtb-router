/**
 * Route library CRUD (E6.1) over a KV abstraction — real IndexedDB in the
 * app, in-memory map in unit tests. All failures degrade gracefully
 * (private mode / quota) to an empty library, never breaking planning.
 */
import { getDB } from '../osm/db';
import type { StoredRoute } from './serialization';

export interface RouteKv {
  getAll(): Promise<StoredRoute[]>;
  get(id: string): Promise<StoredRoute | undefined>;
  put(value: StoredRoute): Promise<void>;
  delete(id: string): Promise<void>;
}

class IdbRouteKv implements RouteKv {
  async getAll(): Promise<StoredRoute[]> {
    try {
      const all = (await (await getDB()).getAll('routes')) as StoredRoute[];
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<StoredRoute | undefined> {
    try {
      return (await (await getDB()).get('routes', id)) as StoredRoute | undefined;
    } catch {
      return undefined;
    }
  }

  async put(value: StoredRoute): Promise<void> {
    try {
      // callers may hand down reactive proxies (shallow spreads of store
      // state) — structuredClone/IDB cannot clone them. StoredRoute is pure
      // JSON, so a JSON round-trip is a safe deep copy in plain TS (no runes
      // available in this module).
      const plain = JSON.parse(JSON.stringify(value)) as StoredRoute;
      await (await getDB()).put('routes', plain, plain.id);
    } catch {
      // best-effort persistence
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await (await getDB()).delete('routes', id);
    } catch {
      // best-effort persistence
    }
  }
}

export class MemoryRouteKv implements RouteKv {
  constructor(public map = new Map<string, StoredRoute>()) {}

  async getAll(): Promise<StoredRoute[]> {
    return [...this.map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredRoute | undefined> {
    return this.map.get(id);
  }

  async put(value: StoredRoute): Promise<void> {
    this.map.set(value.id, structuredClone(value));
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}

let backend: RouteKv = new IdbRouteKv();

/** test hook */
export function setRouteKv(kv: RouteKv): void {
  backend = kv;
}

export async function listRoutes(): Promise<StoredRoute[]> {
  return backend.getAll();
}

export async function getRoute(id: string): Promise<StoredRoute | undefined> {
  return backend.get(id);
}

export async function saveRoute(record: StoredRoute): Promise<void> {
  await backend.put(record);
}

export async function deleteRoute(id: string): Promise<void> {
  await backend.delete(id);
}

export async function duplicateRoute(id: string): Promise<StoredRoute | undefined> {
  const original = await backend.get(id);
  if (!original) return undefined;
  const copy: StoredRoute = {
    ...structuredClone(original),
    id: newId(),
    name: `${original.name} (2)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await backend.put(copy);
  return copy;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
