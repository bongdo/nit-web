const DB_NAME = "nit-gui.draft-files";
const STORE_NAME = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveDraftFiles(key: string, files: File[]): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (files.length > 0) store.put(files, key);
    else store.delete(key);
    await done(transaction);
  } finally {
    db.close();
  }
}

export async function loadDraftFiles(key: string): Promise<File[]> {
  const db = await open();
  try {
    const files = await new Promise<File[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        resolve(Array.isArray(value) ? value.filter((item): item is File => item instanceof File) : []);
      };
      request.onerror = () => reject(request.error);
    });
    return files;
  } finally {
    db.close();
  }
}
