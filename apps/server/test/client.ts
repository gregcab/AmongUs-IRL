import type { Ack, ClientView, ServerToClientPayloads } from "@among-us/shared";
import { io, type Socket } from "socket.io-client";

/** Minimal socket.io test/simulation client that records views and events. */
export class TestClient {
  readonly socket: Socket;
  view?: ClientView;
  readonly events: { name: string; payload: unknown }[] = [];
  private waiters: (() => void)[] = [];

  constructor(url: string, auth: Record<string, unknown> = {}) {
    this.socket = io(url, { auth, transports: ["websocket"], forceNew: true, reconnection: false });
    this.socket.on("state:sync", (v: ClientView) => {
      this.view = v;
      this.notify();
    });
    this.socket.onAny((name: string, payload: unknown) => {
      if (name !== "state:sync") this.events.push({ name, payload });
      this.notify();
    });
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  async connected(): Promise<this> {
    if (this.socket.connected) return this;
    await new Promise<void>((resolve, reject) => {
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", reject);
    });
    return this;
  }

  send<T = unknown>(name: string, payload: unknown = {}): Promise<Ack<T>> {
    return this.socket.timeout(5000).emitWithAck(name, payload) as Promise<Ack<T>>;
  }

  async ok<T = unknown>(name: string, payload: unknown = {}): Promise<T | undefined> {
    const res = await this.send<T>(name, payload);
    if (!res.ok) throw new Error(`${name} failed: ${res.error.code} ${res.error.message}`);
    return res.data;
  }

  /** Resolves once `predicate` holds for the latest view (or rejects after `timeout` ms). */
  until(predicate: (view: ClientView) => boolean, timeout = 5000): Promise<ClientView> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for view; last: ${JSON.stringify(this.view)?.slice(0, 400)}`)), timeout);
      const check = () => {
        if (this.view && predicate(this.view)) {
          clearTimeout(timer);
          resolve(this.view);
        } else {
          this.waiters.push(check);
        }
      };
      check();
    });
  }

  event<N extends keyof ServerToClientPayloads>(name: N, timeout = 5000): Promise<ServerToClientPayloads[N]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for event ${name}`)), timeout);
      const check = () => {
        const found = this.events.find((e) => e.name === name);
        if (found) {
          clearTimeout(timer);
          resolve(found.payload as ServerToClientPayloads[N]);
        } else {
          this.waiters.push(check);
        }
      };
      check();
    });
  }

  close(): void {
    this.socket.close();
  }
}
