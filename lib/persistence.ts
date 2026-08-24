'use client';

import type { SchemaDef } from './schemas';

const DATABASE_NAME = 'querytrace';
const DATABASE_VERSION = 1;
const STORE_NAME = 'app-state';
const STATE_KEY = 'current';
const STATE_VERSION = 1;

export interface PersistedAppState {
  version: typeof STATE_VERSION;
  lastSchemaId: string;
  customSchema?: SchemaDef;
  customDatabase?: Uint8Array;
  ranLessons: Record<string, boolean>;
}

let openPromise: Promise<IDBDatabase> | null = null;
let persistenceAvailable = typeof indexedDB !== 'undefined';
let writeQueue = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (!persistenceAvailable) return Promise.reject(new Error('IndexedDB is unavailable.'));
  openPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked.'));
  }).catch((error) => {
    persistenceAvailable = false;
    openPromise = null;
    throw error;
  });
  return openPromise!;
}

function normalizeBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return undefined;
}

export async function loadPersistedAppState(): Promise<PersistedAppState | null> {
  if (!persistenceAvailable) return null;
  try {
    const database = await openDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!value || typeof value !== 'object') return null;
    const saved = value as Partial<PersistedAppState>;
    if (saved.version !== STATE_VERSION || typeof saved.lastSchemaId !== 'string') return null;
    const ranLessons = Object.fromEntries(
      Object.entries(saved.ranLessons ?? {}).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
      )
    );
    const customSchema =
      saved.customSchema?.id === 'custom' && typeof saved.customSchema.ddl === 'string'
        ? saved.customSchema
        : undefined;
    return {
      version: STATE_VERSION,
      lastSchemaId: saved.lastSchemaId,
      customSchema,
      customDatabase: normalizeBytes(saved.customDatabase),
      ranLessons,
    };
  } catch {
    // Safari private mode and restrictive embedding policies can deny storage.
    // The app remains fully usable as an in-memory session in that case.
    persistenceAvailable = false;
    return null;
  }
}

async function writeState(state: PersistedAppState): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Queue whole-state writes so rapid lesson runs cannot overwrite newer progress. */
export function savePersistedAppState(
  state: Omit<PersistedAppState, 'version'>
): Promise<void> {
  if (!persistenceAvailable) return Promise.resolve();
  const snapshot: PersistedAppState = { version: STATE_VERSION, ...state };
  writeQueue = writeQueue.then(() => writeState(snapshot)).catch(() => {
    persistenceAvailable = false;
  });
  return writeQueue;
}

/** Best effort only: browsers may decline, especially Safari private browsing. */
export function requestDurableStorage(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => false);
}
