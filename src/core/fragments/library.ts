import { decodeVisualFragmentPackage, encodeVisualFragmentPackage } from "./package";
import type {
  VisualFragmentLibraryQuery,
  VisualFragmentLibraryRecord,
  VisualFragmentPackage,
} from "./types";

const DATABASE_NAME = "last-mile-studio-visual-fragments";
const DATABASE_VERSION = 1;
const STORE_NAME = "fragments";

interface FragmentStorage {
  readonly persistent: boolean;
  list(): Promise<VisualFragmentLibraryRecord[]>;
  get(key: string): Promise<VisualFragmentLibraryRecord | undefined>;
  put(record: VisualFragmentLibraryRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

function cloneRecord(record: VisualFragmentLibraryRecord): VisualFragmentLibraryRecord {
  return {
    ...record,
    manifest: structuredClone(record.manifest),
    packageBytes: new Uint8Array(record.packageBytes),
  };
}

export class MemoryVisualFragmentStorage implements FragmentStorage {
  readonly persistent = false;
  private readonly records = new Map<string, VisualFragmentLibraryRecord>();

  async list(): Promise<VisualFragmentLibraryRecord[]> {
    return Array.from(this.records.values(), cloneRecord);
  }

  async get(key: string): Promise<VisualFragmentLibraryRecord | undefined> {
    const record = this.records.get(key);
    return record ? cloneRecord(record) : undefined;
  }

  async put(record: VisualFragmentLibraryRecord): Promise<void> {
    this.records.set(record.key, cloneRecord(record));
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

class IndexedDbVisualFragmentStorage implements FragmentStorage {
  readonly persistent = true;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("fragmentId", "fragmentId", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
          store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法打开视觉片段数据库。"));
      request.onblocked = () => reject(new Error("视觉片段数据库升级被其他页面阻塞。"));
    });
    return this.databasePromise;
  }

  private async request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.database();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? transaction.error ?? new Error("视觉片段数据库操作失败。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("视觉片段数据库事务已中止。"));
    });
  }

  async list(): Promise<VisualFragmentLibraryRecord[]> {
    const records = await this.request<VisualFragmentLibraryRecord[]>("readonly", (store) => store.getAll());
    return records.map((record) => ({ ...record, packageBytes: new Uint8Array(record.packageBytes) }));
  }

  async get(key: string): Promise<VisualFragmentLibraryRecord | undefined> {
    const record = await this.request<VisualFragmentLibraryRecord | undefined>("readonly", (store) => store.get(key));
    return record ? { ...record, packageBytes: new Uint8Array(record.packageBytes) } : undefined;
  }

  async put(record: VisualFragmentLibraryRecord): Promise<void> {
    await this.request<IDBValidKey>("readwrite", (store) => store.put(cloneRecord(record)));
  }

  async delete(key: string): Promise<void> {
    await this.request<undefined>("readwrite", (store) => store.delete(key));
  }
}

class ResilientFragmentStorage implements FragmentStorage {
  private readonly fallback = new MemoryVisualFragmentStorage();
  private degraded = false;

  constructor(private readonly primary: FragmentStorage | null) {}

  get persistent(): boolean {
    return Boolean(this.primary?.persistent && !this.degraded);
  }

  private async use<T>(operation: (storage: FragmentStorage) => Promise<T>): Promise<T> {
    if (!this.primary || this.degraded) return operation(this.fallback);
    try {
      return await operation(this.primary);
    } catch {
      this.degraded = true;
      return operation(this.fallback);
    }
  }

  list(): Promise<VisualFragmentLibraryRecord[]> {
    return this.use((storage) => storage.list());
  }

  get(key: string): Promise<VisualFragmentLibraryRecord | undefined> {
    return this.use((storage) => storage.get(key));
  }

  put(record: VisualFragmentLibraryRecord): Promise<void> {
    return this.use((storage) => storage.put(record));
  }

  delete(key: string): Promise<void> {
    return this.use((storage) => storage.delete(key));
  }
}

function recordKey(fragmentId: string, version: string): string {
  return `${fragmentId}@${version}`;
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, string] => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""] : [0, 0, 0, value];
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] as number - (rightParts[index] as number);
    if (difference) return difference;
  }
  if (leftParts[3] === rightParts[3]) return 0;
  if (!leftParts[3]) return 1;
  if (!rightParts[3]) return -1;
  return leftParts[3].localeCompare(rightParts[3]);
}

function queryMatches(record: VisualFragmentLibraryRecord, query: VisualFragmentLibraryQuery): boolean {
  if (query.favoritesOnly && !record.favorite) return false;
  if (query.category && record.manifest.category !== query.category) return false;
  if (query.tags?.length && !query.tags.every((tag) => record.manifest.tags.includes(tag))) return false;
  const search = query.search?.trim().toLocaleLowerCase();
  if (search) {
    const haystack = [
      record.manifest.name,
      record.manifest.description,
      record.manifest.category,
      record.manifest.fragmentId,
      record.manifest.version,
      record.manifest.provenance.sourceProject,
      record.manifest.provenance.sourceDocument,
      ...record.manifest.tags,
    ]
      .join("\n").toLocaleLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

export class VisualFragmentLibrary {
  constructor(private readonly storage: FragmentStorage = new ResilientFragmentStorage(
    typeof indexedDB === "undefined" ? null : new IndexedDbVisualFragmentStorage(indexedDB),
  )) {}

  get persistent(): boolean {
    return this.storage.persistent;
  }

  async save(fragment: VisualFragmentPackage, favorite?: boolean): Promise<VisualFragmentLibraryRecord> {
    const packageBytes = await encodeVisualFragmentPackage(fragment);
    const key = recordKey(fragment.manifest.fragmentId, fragment.manifest.version);
    const existing = await this.storage.get(key);
    const now = new Date().toISOString();
    const record: VisualFragmentLibraryRecord = {
      key,
      fragmentId: fragment.manifest.fragmentId,
      version: fragment.manifest.version,
      manifest: structuredClone(fragment.manifest),
      packageBytes,
      favorite: favorite ?? existing?.favorite ?? false,
      useCount: existing?.useCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: existing?.lastUsedAt,
    };
    await this.storage.put(record);
    return cloneRecord(record);
  }

  async importPackage(bytes: Blob | ArrayBuffer | Uint8Array): Promise<VisualFragmentLibraryRecord> {
    return this.save(await decodeVisualFragmentPackage(bytes));
  }

  async list(query: VisualFragmentLibraryQuery = {}): Promise<VisualFragmentLibraryRecord[]> {
    const records = (await this.storage.list()).filter((record) => queryMatches(record, query));
    return records.sort((left, right) => {
      if (query.recentFirst) return (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") || right.updatedAt.localeCompare(left.updatedAt);
      return left.manifest.name.localeCompare(right.manifest.name) || compareVersions(right.version, left.version);
    });
  }

  async getRecord(fragmentId: string, version?: string): Promise<VisualFragmentLibraryRecord | undefined> {
    if (version) return this.storage.get(recordKey(fragmentId, version));
    return (await this.storage.list())
      .filter((record) => record.fragmentId === fragmentId)
      .sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  async get(fragmentId: string, version?: string): Promise<VisualFragmentPackage | undefined> {
    const record = await this.getRecord(fragmentId, version);
    return record ? decodeVisualFragmentPackage(record.packageBytes) : undefined;
  }

  async setFavorite(fragmentId: string, version: string, favorite: boolean): Promise<void> {
    const record = await this.storage.get(recordKey(fragmentId, version));
    if (!record) throw new Error(`本地库中没有视觉片段：${fragmentId}@${version}`);
    record.favorite = favorite;
    record.updatedAt = new Date().toISOString();
    await this.storage.put(record);
  }

  async markUsed(fragmentId: string, version: string): Promise<void> {
    const record = await this.storage.get(recordKey(fragmentId, version));
    if (!record) throw new Error(`本地库中没有视觉片段：${fragmentId}@${version}`);
    record.useCount += 1;
    record.lastUsedAt = new Date().toISOString();
    await this.storage.put(record);
  }

  async delete(fragmentId: string, version?: string): Promise<number> {
    const records = version
      ? [await this.storage.get(recordKey(fragmentId, version))].filter((record): record is VisualFragmentLibraryRecord => Boolean(record))
      : (await this.storage.list()).filter((record) => record.fragmentId === fragmentId);
    await Promise.all(records.map((record) => this.storage.delete(record.key)));
    return records.length;
  }

  async exportBytes(fragmentId: string, version?: string): Promise<Uint8Array> {
    const record = await this.getRecord(fragmentId, version);
    if (!record) throw new Error(`本地库中没有视觉片段：${fragmentId}${version ? `@${version}` : ""}`);
    return new Uint8Array(record.packageBytes);
  }
}
