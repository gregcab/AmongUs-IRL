import { useEffect, useState } from "react";

let offset = 0;

/** Estimated server time; all deadlines in views are server timestamps. */
export function serverNow(): number {
  return Date.now() + offset;
}

export function setServerOffset(sentAt: number, serverTime: number, receivedAt: number): void {
  offset = serverTime - (sentAt + receivedAt) / 2;
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function secondsLeft(endsAt: number | undefined, now: number): number {
  if (endsAt === undefined) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
