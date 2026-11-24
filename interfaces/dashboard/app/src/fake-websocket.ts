import { vi } from 'vitest';

/** A WebSocket the tests drive by hand: nothing connects, nothing closes on its own. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /** Client-initiated close. */
  close(): void {
    this.readyState = 3;
  }

  /** The server accepted the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** The server sent `{ type, data }`. */
  receive(type: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }

  /** The connection ended from the other side. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  /** Messages the client sent, parsed. */
  messages(): unknown[] {
    return this.sent.map((text) => JSON.parse(text) as unknown);
  }
}

export function stubWebSocket(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
}

export function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('No WebSocket was opened.');
  return socket;
}

/** Timers that only move when the test says so. */
export class FakeClock {
  time = 1_000_000;
  #next = 1;
  #timers = new Map<number, { at: number; callback: () => void }>();

  now = (): number => this.time;

  setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.#next++;
    this.#timers.set(id, { at: this.time + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.#timers.delete(handle as number);
  };

  /** Delays (ms from now) of the timers still waiting, soonest first. */
  pendingDelays(): number[] {
    return [...this.#timers.values()].map((t) => t.at - this.time).sort((a, b) => a - b);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Infinity;
      for (const [id, timer] of this.#timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextId = id;
          nextAt = timer.at;
        }
      }
      if (nextId === undefined) break;
      const timer = this.#timers.get(nextId);
      this.#timers.delete(nextId);
      this.time = Math.max(this.time, nextAt);
      timer?.callback();
    }
    this.time = target;
  }
}
