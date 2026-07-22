'use client';

import type { LocalBackup, LocalCustomProduct, LocalProfile, LocalSale } from './local-only-model';

const DB_NAME = 'sugi-local-only-v1';
const DB_VERSION = 1;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sales')) {
        const sales = db.createObjectStore('sales', { keyPath: 'id' });
        sales.createIndex('saleDate', 'saleDate', { unique: false });
        sales.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('customProducts')) db.createObjectStore('customProducts', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
}

export async function getLocalProfile(): Promise<LocalProfile | null> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('profile', 'readonly');
    return (await requestResult(transaction.objectStore('profile').get('local'))) ?? null;
  } finally {
    db.close();
  }
}

export async function saveLocalProfile(profile: LocalProfile): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('profile', 'readwrite');
    transaction.objectStore('profile').put(profile);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function listLocalSales(): Promise<LocalSale[]> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('sales', 'readonly');
    const rows = await requestResult(transaction.objectStore('sales').getAll());
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    db.close();
  }
}

export async function addLocalSale(sale: LocalSale): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('sales', 'readwrite');
    transaction.objectStore('sales').add(sale);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function updateLocalSale(id: string, changes: Partial<Pick<LocalSale, 'quantity' | 'pointsPerItem'>>): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('sales', 'readwrite');
    const store = transaction.objectStore('sales');
    const existing = await requestResult<LocalSale | undefined>(store.get(id));
    if (!existing) throw new Error('記録が見つかりません');
    const next = { ...existing, ...changes };
    if (!Number.isInteger(next.quantity) || next.quantity <= 0 || !Number.isFinite(next.pointsPerItem) || next.pointsPerItem <= 0) {
      throw new Error('数量または点数が不正です');
    }
    store.put(next);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteLocalSale(id: string): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('sales', 'readwrite');
    transaction.objectStore('sales').delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function listCustomProducts(): Promise<LocalCustomProduct[]> {
  const db = await openLocalDb();
  try {
    return await requestResult(db.transaction('customProducts', 'readonly').objectStore('customProducts').getAll());
  } finally {
    db.close();
  }
}

export async function addCustomProduct(product: LocalCustomProduct): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('customProducts', 'readwrite');
    transaction.objectStore('customProducts').add(product);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function updateCustomProduct(product: LocalCustomProduct): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('customProducts', 'readwrite');
    transaction.objectStore('customProducts').put(product);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteCustomProduct(id: string): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction('customProducts', 'readwrite');
    transaction.objectStore('customProducts').delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function createLocalBackup(): Promise<LocalBackup> {
  const [profile, sales, customProducts] = await Promise.all([
    getLocalProfile(),
    listLocalSales(),
    listCustomProducts(),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), profile, sales, customProducts };
}

export async function restoreLocalBackup(backup: LocalBackup): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction(['profile', 'sales', 'customProducts'], 'readwrite');
    const profileStore = transaction.objectStore('profile');
    const salesStore = transaction.objectStore('sales');
    const productsStore = transaction.objectStore('customProducts');
    profileStore.clear();
    salesStore.clear();
    productsStore.clear();
    if (backup.profile) profileStore.put(backup.profile);
    backup.sales.forEach((sale) => salesStore.put(sale));
    backup.customProducts.forEach((product) => productsStore.put(product));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function clearAllLocalData(): Promise<void> {
  const db = await openLocalDb();
  try {
    const transaction = db.transaction(['profile', 'sales', 'customProducts'], 'readwrite');
    transaction.objectStore('profile').clear();
    transaction.objectStore('sales').clear();
    transaction.objectStore('customProducts').clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
