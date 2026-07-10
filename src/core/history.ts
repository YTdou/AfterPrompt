export interface HistoryState<T> {
  value: T;
  label: string;
  timestamp: number;
  coalesceKey?: string;
}

export class History<T> {
  private past: HistoryState<T>[] = [];
  private future: HistoryState<T>[] = [];
  private current: HistoryState<T>;

  constructor(initialValue: T, private readonly equals: (left: T, right: T) => boolean, private readonly limit = 100) {
    this.current = { value: initialValue, label: "Initial document", timestamp: Date.now() };
  }

  reset(value: T, label = "Loaded document"): void {
    this.past = [];
    this.future = [];
    this.current = { value, label, timestamp: Date.now() };
  }

  replaceCurrent(value: T): void {
    this.current = { ...this.current, value };
  }

  commit(value: T, label: string, coalesceKey?: string): boolean {
    if (this.equals(this.current.value, value)) return false;
    const now = Date.now();
    const coalesces = Boolean(
      coalesceKey &&
      this.current.coalesceKey === coalesceKey &&
      now - this.current.timestamp < 600,
    );

    if (!coalesces) this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = { value, label, timestamp: now, coalesceKey };
    this.future = [];
    return true;
  }

  undo(): T | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.current);
    this.current = previous;
    return previous.value;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return next.value;
  }

  get value(): T {
    return this.current.value;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }
}
