'use client';

import type { SchemaDef } from './schemas';

const DATABASE_NAME = 'querytrace';
const DATABASE_VERSION = 1;
const STORE_NAME = 'app-state';
const STATE_KEY = 'current';
const STATE_VERSION = 3;

export interface PersistedAppState {
  version: typeof STATE_VERSION;
  /** Increased only when the saved custom database changes, across every tab. */
  customRevision: number;
  lastSchemaId: string;
  customSchema?: SchemaDef;
  customDatabase?: Uint8Array;
  /** Unbuilt schema SQL the user was still editing, so a failed attempt is never lost. */
  customDdlDraft?: string;
  ranLessons: Record<string, boolean>;
}

let openPromise: Promise<IDBDatabase> | null = null;
let persistenceAvailable = typeof indexedDB !== 'undefined';
let writeQueue = Promise.resolve();

export class PersistenceConflictError extends Error {
  constructor(readonly current: PersistedAppState) {
    super('Another tab changed the saved custom schema. This change was not saved.');
    this.name = 'PersistenceConflictError';
  }
}

export type PersistedStatePatch = Partial<Omit<PersistedAppState, 'version' | 'customRevision'>>;

function normalizeState(value: unknown): PersistedAppState | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Omit<Partial<PersistedAppState>, 'version'> & { version?: number };
  if (![1, 2, STATE_VERSION].includes(saved.version ?? -1) || typeof saved.lastSchemaId !== 'string') return null;
  const ranLessons = Object.fromEntries(Object.entries(saved.ranLessons ?? {}).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
  ));
  const customSchema = saved.customSchema?.id === 'custom' && typeof saved.customSchema.ddl === 'string'
    ? saved.customSchema : undefined;
  const currentCurriculum = saved.version === STATE_VERSION;
  return {
    version: STATE_VERSION,
    customRevision: Number.isSafeInteger(saved.customRevision) && saved.customRevision! >= 0 ? saved.customRevision! : 0,
    lastSchemaId: currentCurriculum || (saved.lastSchemaId === 'custom' && customSchema) ? saved.lastSchemaId : 'observatory',
    customSchema,
    customDatabase: normalizeBytes(saved.customDatabase),
    customDdlDraft: typeof saved.customDdlDraft === 'string' ? saved.customDdlDraft : undefined,
    ranLessons: currentCurriculum ? ranLessons : {},
  };
}

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
    return normalizeState(value);
  } catch {
    // Safari private mode and restrictive embedding policies can deny storage.
    // The app remains fully usable as an in-memory session in that case.
    persistenceAvailable = false;
    return null;
  }
}

async function writeState(patch: PersistedStatePatch, expectedCustomRevision?: number): Promise<PersistedAppState> {
  const database = await openDatabase();
  return new Promise<PersistedAppState>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    let next: PersistedAppState;
    let conflict: PersistenceConflictError | undefined;
    request.onsuccess = () => {
      const current = normalizeState(request.result) ?? {
        version: STATE_VERSION, customRevision: 0, lastSchemaId: 'observatory', ranLessons: {},
      };
      // The read and write share one IndexedDB transaction, so competing tabs
      // cannot both commit a mutation based on the same saved checkpoint.
      if (expectedCustomRevision !== undefined && current.customRevision !== expectedCustomRevision) {
        conflict = new PersistenceConflictError(current);
        transaction.abort();
        return;
      }
      next = {
        ...current, ...patch,
        customRevision: current.customRevision + (expectedCustomRevision === undefined ? 0 : 1),
        ranLessons: { ...current.ranLessons, ...patch.ranLessons },
      };
      store.put(next, STATE_KEY);
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(conflict ?? transaction.error);
  });
}

/** Patch only changed fields; database writes also require the caller's revision. */
export function savePersistedAppState(
  patch: PersistedStatePatch,
  expectedCustomRevision?: number
): Promise<PersistedAppState | null> {
  if (!persistenceAvailable) return Promise.resolve(null);
  if (('customSchema' in patch || 'customDatabase' in patch) && expectedCustomRevision === undefined) {
    return Promise.reject(new Error('Saving a custom database requires its checkpoint revision.'));
  }
  const queued = writeQueue.then(() => writeState(patch, expectedCustomRevision)).catch((error: unknown) => {
    if (error instanceof PersistenceConflictError) throw error;
    persistenceAvailable = false;
    return null;
  });
  writeQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

/** Best effort only: browsers may decline, especially Safari private browsing. */
export function requestDurableStorage(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => false);
}
