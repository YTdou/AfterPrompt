import { decodeVisualFragmentPackage, encodeVisualFragmentPackage } from "./package";
import type {
  VisualFragmentLibraryQuery,
  VisualFragmentLibraryRecord,
  VisualFragmentPackage,
} from "./types";

const DATABASE_NAME = "last-mile-studio-visual-fragments";
const DATABASE_VERSION = 2;
const STORE_NAME = "fragments";
const SETTINGS_STORE_NAME = "settings";
const DIRECTORY_HANDLE_KEY = "fragment-directory-handle";
const DIRECTORY_METADATA_FILE = ".last-mile-library.json";

export type FragmentStorageKind = "directory" | "indexeddb" | "memory";

export interface FragmentStorage {
  readonly persistent: boolean;
  readonly kind: FragmentStorageKind;
  readonly label: string;
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
  readonly kind = "memory" as const;
  readonly label = "会话临时片段剪贴板";
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
  readonly kind = "indexeddb" as const;
  readonly label = "临时片段剪贴板";
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
        if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) database.createObjectStore(SETTINGS_STORE_NAME);
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

  get kind(): FragmentStorageKind {
    return this.primary?.persistent && !this.degraded ? this.primary.kind : "memory";
  }

  get label(): string {
    return this.primary?.persistent && !this.degraded ? this.primary.label : this.fallback.label;
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

export interface FragmentWritableLike {
  write(data: Uint8Array | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FragmentFileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ name: string; lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<FragmentWritableLike>;
}

export interface FragmentDirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<FragmentFileHandleLike | { readonly kind: "directory"; readonly name: string }>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FragmentFileHandleLike>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

function fragmentFileName(record: Pick<VisualFragmentLibraryRecord, "fragmentId" | "version">): string {
  const safe = `${record.fragmentId}@${record.version}`.replace(/[^A-Za-z0-9._@-]+/g, "-").slice(0, 180) || "fragment";
  return `${safe}.vfrag`;
}

export class FileSystemVisualFragmentStorage implements FragmentStorage {
  readonly persistent = true;
  readonly kind = "directory" as const;
  readonly label: string;

  constructor(readonly handle: FragmentDirectoryHandleLike) {
    this.label = `本地目录：${handle.name}`;
  }

  private async metadata(): Promise<Record<string, Pick<VisualFragmentLibraryRecord, "favorite" | "useCount" | "createdAt" | "updatedAt" | "lastUsedAt">>> {
    try {
      const handle = await this.handle.getFileHandle(DIRECTORY_METADATA_FILE);
      const file = await handle.getFile();
      const value: unknown = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()));
      return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, Pick<VisualFragmentLibraryRecord, "favorite" | "useCount" | "createdAt" | "updatedAt" | "lastUsedAt">> : {};
    } catch {
      return {};
    }
  }

  private async writeMetadata(value: Record<string, Pick<VisualFragmentLibraryRecord, "favorite" | "useCount" | "createdAt" | "updatedAt" | "lastUsedAt">>): Promise<void> {
    const handle = await this.handle.getFileHandle(DIRECTORY_METADATA_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
    await writable.close();
  }

  private async recordsWithFiles(): Promise<Array<{ record: VisualFragmentLibraryRecord; fileName: string }>> {
    const records: Array<{ record: VisualFragmentLibraryRecord; fileName: string }> = [];
    const metadata = await this.metadata();
    for await (const entry of this.handle.values()) {
      if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".vfrag")) continue;
      try {
        const file = await entry.getFile();
        const packageBytes = new Uint8Array(await file.arrayBuffer());
        const fragment = await decodeVisualFragmentPackage(packageBytes);
        const timestamp = new Date(file.lastModified || Date.now()).toISOString();
        const key = recordKey(fragment.manifest.fragmentId, fragment.manifest.version);
        const local = metadata[key];
        records.push({
          fileName: entry.name,
          record: {
            key,
            fragmentId: fragment.manifest.fragmentId,
            version: fragment.manifest.version,
            manifest: fragment.manifest,
            packageBytes,
            favorite: local?.favorite ?? false,
            useCount: local?.useCount ?? 0,
            createdAt: local?.createdAt ?? timestamp,
            updatedAt: local?.updatedAt ?? timestamp,
            lastUsedAt: local?.lastUsedAt,
          },
        });
      } catch {
        // Invalid packages remain untouched on disk and are omitted from the usable library.
      }
    }
    return records;
  }

  async list(): Promise<VisualFragmentLibraryRecord[]> {
    return (await this.recordsWithFiles()).map(({ record }) => cloneRecord(record));
  }

  async get(key: string): Promise<VisualFragmentLibraryRecord | undefined> {
    return (await this.recordsWithFiles()).find(({ record }) => record.key === key)?.record;
  }

  async put(record: VisualFragmentLibraryRecord): Promise<void> {
    const handle = await this.handle.getFileHandle(fragmentFileName(record), { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(record.packageBytes));
    await writable.close();
    const metadata = await this.metadata();
    metadata[record.key] = {
      favorite: record.favorite,
      useCount: record.useCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt,
    };
    await this.writeMetadata(metadata);
  }

  async delete(key: string): Promise<void> {
    const matches = (await this.recordsWithFiles()).filter(({ record }) => record.key === key);
    for (const match of matches) await this.handle.removeEntry(match.fileName);
    const metadata = await this.metadata();
    delete metadata[key];
    await this.writeMetadata(metadata);
  }
}

async function settingsDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("浏览器不支持 IndexedDB，无法记住本地片段目录。");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("fragmentId", "fragmentId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) database.createObjectStore(SETTINGS_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开片段设置数据库。"));
  });
}

export async function rememberFragmentDirectory(handle: FragmentDirectoryHandleLike | null): Promise<void> {
  const database = await settingsDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SETTINGS_STORE_NAME, "readwrite");
    const request = handle
      ? transaction.objectStore(SETTINGS_STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY)
      : transaction.objectStore(SETTINGS_STORE_NAME).delete(DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("无法保存本地片段目录授权。"));
  });
  database.close();
}

export async function recalledFragmentDirectory(): Promise<FragmentDirectoryHandleLike | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await settingsDatabase();
  const handle = await new Promise<FragmentDirectoryHandleLike | null>((resolve, reject) => {
    const request = database.transaction(SETTINGS_STORE_NAME, "readonly").objectStore(SETTINGS_STORE_NAME).get(DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as FragmentDirectoryHandleLike | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("无法读取本地片段目录授权。"));
  });
  database.close();
  return handle;
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

  get storageKind(): FragmentStorageKind {
    return this.storage.kind;
  }

  get storageLabel(): string {
    return this.storage.label;
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

  async latestRecord(): Promise<VisualFragmentLibraryRecord | undefined> {
    return (await this.storage.list()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
      || right.manifest.provenance.createdAt.localeCompare(left.manifest.provenance.createdAt)
      || right.key.localeCompare(left.key),
    )[0];
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

  async copyTo(target: VisualFragmentLibrary): Promise<number> {
    const records = await this.storage.list();
    for (const record of records) await target.importPackage(record.packageBytes);
    return records.length;
  }
}
