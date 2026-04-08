const DB_NAME = "scroll-capture-studio";
const DB_VERSION = 1;
const ASSET_STORE = "assets";

export async function putAssetFromDataUrl(assetId: string, dataUrl: string, meta: Record<string, unknown> = {}) {
  const blob = await dataUrlToBlob(dataUrl);
  return putAssetBlob(assetId, blob, meta);
}

export async function putAssetBlob(assetId: string, blob: Blob, meta: Record<string, unknown> = {}) {
  const db = await openAssetDb();
  const timestamp = (meta.createdAt as string | undefined) ?? new Date().toISOString();
  const record = {
    assetId,
    blob,
    mime: (meta.mime as string | undefined) ?? blob.type ?? "application/octet-stream",
    byteLength: (meta.byteLength as number | undefined) ?? blob.size ?? null,
    createdAt: timestamp,
    updatedAt: new Date().toISOString(),
    ...meta,
  };

  const transaction = db.transaction(ASSET_STORE, "readwrite");
  const store = transaction.objectStore(ASSET_STORE);
  await requestToPromise(store.put(record));
  await transactionToPromise(transaction);
  return record;
}

export async function getAssetRecord(assetId: string) {
  const db = await openAssetDb();
  const transaction = db.transaction(ASSET_STORE, "readonly");
  const store = transaction.objectStore(ASSET_STORE);
  const record = await requestToPromise(store.get(assetId));
  await transactionToPromise(transaction);
  return record ?? null;
}

export async function getAssetBlob(assetId: string) {
  const record = await getAssetRecord(assetId);
  return record?.blob ?? null;
}

export async function getAssetDataUrl(assetId: string) {
  const blob = await getAssetBlob(assetId);
  if (!blob) {
    return null;
  }

  return blobToDataUrl(blob);
}

export async function deleteAsset(assetId: string) {
  const db = await openAssetDb();
  const transaction = db.transaction(ASSET_STORE, "readwrite");
  const store = transaction.objectStore(ASSET_STORE);
  await requestToPromise(store.delete(assetId));
  await transactionToPromise(transaction);
}

export async function hasAsset(assetId: string) {
  const record = await getAssetRecord(assetId);
  return Boolean(record);
}

export const readAssetDataUrl = getAssetDataUrl;
export const loadAssetDataUrl = getAssetDataUrl;
export const readAssetBlob = getAssetBlob;
export const loadAssetBlob = getAssetBlob;
export const readAsset = getAssetRecord;
export const getAsset = getAssetRecord;
export const loadAsset = getAssetRecord;
export const putAssetDataUrl = putAssetFromDataUrl;

export default {
  putAssetFromDataUrl,
  putAssetBlob,
  putAssetDataUrl,
  getAssetRecord,
  getAssetBlob,
  getAssetDataUrl,
  readAssetDataUrl,
  loadAssetDataUrl,
  readAssetBlob,
  loadAssetBlob,
  readAsset,
  getAsset,
  loadAsset,
  deleteAsset,
  hasAsset,
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openAssetDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ASSET_STORE)) {
          db.createObjectStore(ASSET_STORE, {
            keyPath: "assetId",
          });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error ?? new Error("Failed to open asset database."));
      };

      request.onblocked = () => {
        reject(new Error("Asset database upgrade was blocked by another open extension page."));
      };
    });
  }

  return dbPromise;
}

function requestToPromise<T = unknown>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function blobToDataUrl(blob: Blob) {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(String(reader.result ?? ""));
      };
      reader.onerror = () => {
        reject(new Error("Failed to read blob as data URL."));
      };
      reader.readAsDataURL(blob);
    });
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  const base64 = btoa(binary);
  const mime = blob.type || "application/octet-stream";
  return `data:${mime};base64,${base64}`;
}
