/**
 * IndexedDB singleton for corridor + elevation tile caches (PLAN §12).
 * One database, versioned; all stores created in a single upgrade path so
 * multiple modules can share the connection safely.
 */
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'mtb-router';
export const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | undefined;

export function getDB(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('corridors')) {
        database.createObjectStore('corridors');
      }
      if (!database.objectStoreNames.contains('elevationTiles')) {
        database.createObjectStore('elevationTiles');
      }
    },
  });
  return dbPromise;
}
