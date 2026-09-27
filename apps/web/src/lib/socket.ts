import type { Ack, ClientView, GameError, ServerToClientPayloads } from "@among-us/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { setServerOffset } from "./clock";

type Listener = (name: string, payload: unknown) => void;

export interface GameConnection {
  view: ClientView | null;
  connected: boolean;
  send: <T = unknown>(name: string, payload?: unknown) => Promise<Ack<T>>;
  reconnect: () => void;
}

const DISCONNECTED: GameError = { code: "BAD_REQUEST", message: "Connexion au serveur perdue" };

function syncClock(socket: Socket): void {
  const sentAt = Date.now();
  socket.timeout(3000).emit("clock:sync", (err: unknown, serverTime: number) => {
    if (!err && typeof serverTime === "number") setServerOffset(sentAt, serverTime, Date.now());
  });
}

/**
 * One socket per view. `state:sync` is the single source of truth for rendering; other
 * events only trigger side effects (sound, vibration, animations) through `onEvent`.
 */
export function useGameConnection(getAuth: () => Record<string, unknown>, onEvent?: Listener): GameConnection {
  const [view, setView] = useState<ClientView | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const authRef = useRef(getAuth);
  const eventRef = useRef(onEvent);
  authRef.current = getAuth;
  eventRef.current = onEvent;

  useEffect(() => {
    const socket = io({
      auth: (cb) => cb(authRef.current()),
      transports: ["websocket", "polling"],
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      syncClock(socket);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("state:sync", (v: ClientView) => setView(v));
    socket.onAny((name: string, payload: unknown) => {
      if (name !== "state:sync") eventRef.current?.(name, payload);
    });

    const clockTimer = setInterval(() => socket.connected && syncClock(socket), 30_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (socket.connected) socket.emit("state:request");
      else socket.connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      socket.close();
    };
  }, []);

  const send = useCallback(<T,>(name: string, payload: unknown = {}): Promise<Ack<T>> => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve({ ok: false, error: DISCONNECTED });
    return socket
      .timeout(6000)
      .emitWithAck(name, payload)
      .catch(() => ({ ok: false, error: { code: "BAD_REQUEST", message: "Le serveur ne répond pas" } }) as Ack<T>) as Promise<Ack<T>>;
  }, []);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.disconnect();
    socket.connect();
  }, []);

  return { view, connected, send, reconnect };
}

export type EventPayload<N extends keyof ServerToClientPayloads> = ServerToClientPayloads[N];
