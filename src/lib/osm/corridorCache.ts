/**
 * Corridor cache in IndexedDB (E2.3, PLAN §12). Thin `idb` wrapper — failures
 * (private mode, quota) degrade to "no cache", never break planning.
 */
import type { IDBPDatabase } from 'idb';
import { getDB } from './db';
import type { ParsedWay } from './overpass';

/** Structured-clone-friendly form stored in IDB. */
export interface StoredCorridor {
  createdAt: number;
  /** [id, lat, lng] rows */
  nodes: [number, number, number][];
  ways: ParsedWay[];
}

export async function getCachedCorridor(key: string): Promise<StoredCorridor | undefined> {
  try {
    return (await (await getDB()).get('corridors', key)) as StoredCorridor | undefined;
  } catch {
    return undefined;
  }
}

export async function putCachedCorridor(key: string, value: StoredCorridor): Promise<void> {
  try {
    await (await getDB()).put('corridors', value, key);
  } catch {
    // cache is best-effort
  }
}

/** elevation tile cache accessors (used by the engine worker) */
export interface StoredElevationTile {
  z: number;
  x: number;
  y: number;
  /** decoded meters, row-major, tileSize × tileSize */
  data: Float32Array;
  tileSize: number;
}

export async function getElevationTile(key: string): Promise<StoredElevationTile | undefined> {
  try {
    return (await (await getDB()).get('elevationTiles', key)) as StoredElevationTile | undefined;
  } catch {
    return undefined;
  }
}

export async function putElevationTile(key: string, value: StoredElevationTile): Promise<void> {
  try {
    await (await getDB()).put('elevationTiles', value, key);
  } catch {
    // cache is best-effort
  }
}

export type { IDBPDatabase };
