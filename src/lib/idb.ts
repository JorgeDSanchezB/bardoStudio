/** Caché IndexedDB para los arrays grandes del análisis (picos/envolvente). */

const DB_NAME = "bardo-studio";
const STORE = "analysis";

export interface StoredAnalysis {
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  envDb: Float32Array;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result as T);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB tx error"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("IndexedDB abort"));
    };
  });
}

export function saveAnalysis(
  key: string,
  data: StoredAnalysis
): Promise<IDBValidKey> {
  return run<IDBValidKey>("readwrite", (s) => s.put(data, key));
}

export function loadAnalysis(key: string): Promise<StoredAnalysis | undefined> {
  return run<StoredAnalysis | undefined>("readonly", (s) => s.get(key));
}

export function deleteAnalysis(key: string): Promise<undefined> {
  return run<undefined>("readwrite", (s) => s.delete(key));
}
