import { colorOf, type PublicPlayer } from "@among-us/shared";
import QRCode from "qrcode";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatSeconds, secondsLeft, useNow } from "./clock";
import { Crewmate } from "./crewmate";

export function ColorDot({ color, size = 18 }: { color: string; size?: number }) {
  return <span className="dot" style={{ background: colorOf(color).hex, width: size, height: size }} />;
}

export function PlayerChip({
  player,
  strike,
  size = 24,
}: {
  player: Pick<PublicPlayer, "name" | "color">;
  strike?: boolean;
  size?: number;
}) {
  return (
    <span className={`chip${strike ? " strike" : ""}`}>
      <Crewmate color={player.color} size={size} variant={strike ? "ghost" : "alive"} />
      <span className="chip-name">{player.name}</span>
    </span>
  );
}

export function Countdown({ endsAt, className, unit }: { endsAt?: number; className?: string; unit?: boolean }) {
  const now = useNow();
  if (endsAt === undefined) return null;
  const left = secondsLeft(endsAt, now);
  return (
    <span className={className ?? "countdown"}>
      {formatSeconds(left)}
      {unit && left < 60 ? " s" : ""}
    </span>
  );
}

export function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already released or synthetic: holding still works without capture.
  }
}

/** Press-and-hold action with a progress gauge; releasing early cancels. */
export function HoldButton({
  label,
  holdingLabel,
  durationMs,
  onComplete,
  onProgress,
  disabled,
  className,
}: {
  label: ReactNode;
  holdingLabel?: ReactNode;
  durationMs: number;
  onComplete: () => void;
  /** Hold progress from 0 to 1, back to 0 on release. */
  onProgress?: (progress: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  useEffect(() => {
    progressRef.current?.(progress);
  }, [progress]);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number | null>(null);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) clearTimeout(timer.current);
    frame.current = null;
    timer.current = null;
    startedAt.current = null;
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  // The timeout decides completion; animation frames only draw the gauge (they pause in hidden tabs).
  const start = () => {
    startedAt.current = performance.now();
    timer.current = setTimeout(() => {
      stop();
      doneRef.current();
    }, durationMs);
    const draw = () => {
      if (startedAt.current === null) return;
      setProgress(Math.min(1, (performance.now() - startedAt.current) / durationMs));
      frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);
  };

  return (
    <button
      type="button"
      className={`hold ${className ?? ""}${progress > 0 ? " holding" : ""}`}
      disabled={disabled}
      style={{ "--progress": progress } as CSSProperties}
      onPointerDown={(e) => {
        if (disabled) return;
        capture(e.currentTarget, e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" />
      <span className="hold-label">{progress > 0 && holdingLabel ? holdingLabel : label}</span>
    </button>
  );
}

/**
 * Shows `children` only while the finger stays on the pad. Sliding the finger onto an element
 * marked `data-reveal-action` and releasing it there calls `onAction` (hidden menus).
 * With `overlay`, the content covers the whole screen while held, so it stays reachable
 * wherever the pad sits on a long page.
 */
export function HoldToReveal({
  hint,
  children,
  className,
  onAction,
  overlay,
}: {
  hint: ReactNode;
  children: ReactNode;
  className?: string;
  onAction?: (action: string) => void;
  overlay?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const hide = () => {
    origin.current = null;
    setShown(false);
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || e.pointerId !== start.id) return;
    // A tap on the spot where a button appears must not trigger it: the finger has to slide there.
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 16;
    const target = moved ? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-reveal-action]") : null;
    const container = overlay ? layer.current : e.currentTarget;
    hide();
    if (target && container?.contains(target) && onAction) onAction(target.dataset.revealAction!);
  };
  return (
    <div
      className={`reveal ${className ?? ""}${shown ? " shown" : ""}`}
      onPointerDown={(e) => {
        if (origin.current) return;
        capture(e.currentTarget, e.pointerId);
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        setShown(true);
      }}
      onPointerUp={release}
      onPointerCancel={(e) => e.pointerId === origin.current?.id && hide()}
      onLostPointerCapture={(e) => e.pointerId === origin.current?.id && hide()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {shown && !overlay ? (
        children
      ) : (
        <span className="reveal-hint">
          <span className="fingerprint" />
          {hint}
        </span>
      )}
      {shown &&
        overlay &&
        createPortal(
          <div className="reveal-overlay" ref={layer}>
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Press-and-hold pad reporting `onHold(true)` repeatedly (heartbeat) while pressed and
 * `onHold(false)` on release, when the page is hidden, or when it unmounts.
 */
export function HoldPad({
  onHold,
  heartbeatMs = 1500,
  disabled,
  className,
  children,
}: {
  onHold: (holding: boolean) => void;
  heartbeatMs?: number;
  disabled?: boolean;
  className?: string;
  children: (holding: boolean) => ReactNode;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(onHold);
  holdRef.current = onHold;

  useEffect(() => {
    if (!holding) return;
    holdRef.current(true);
    const beat = setInterval(() => holdRef.current(true), heartbeatMs);
    const onHidden = () => document.visibilityState !== "visible" && setHolding(false);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onHidden);
      holdRef.current(false);
    };
  }, [holding, heartbeatMs]);

  useEffect(() => {
    if (disabled) setHolding(false);
  }, [disabled]);

  const release = () => setHolding(false);
  return (
    <div
      className={`hold-pad ${className ?? ""}${holding ? " holding" : ""}${disabled ? " disabled" : ""}`}
      onPointerDown={(e) => {
        if (disabled) return;
        capture(e.currentTarget, e.pointerId);
        setHolding(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children(holding)}
    </div>
  );
}

export function QrCode({ value, size, className }: { value: string; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  }, [value, size]);
  return <canvas ref={ref} className={className} width={size} height={size} />;
}

export function useToast(): [ReactNode, (message: string, kind?: "error" | "info") => void] {
  const [toast, setToast] = useState<{ message: string; kind: string; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((message: string, kind: "error" | "info" = "error") => setToast({ message, kind, id: Date.now() }), []);
  const node = toast ? (
    <div key={toast.id} className={`toast toast-${toast.kind}`} onClick={() => setToast(null)}>
      {toast.message}
    </div>
  ) : null;
  return [node, show];
}

export function ConnectionBanner({ connected }: { connected: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (connected) return setVisible(false);
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [connected]);
  return visible ? <div className="offline">Connexion perdue, reconnexion…</div> : null;
}

export function playerById(players: PublicPlayer[], id: string | undefined): PublicPlayer | undefined {
  return id ? players.find((p) => p.id === id) : undefined;
}

export function Logo({ color = "red", size = 44 }: { color?: string; size?: number }) {
  return (
    <div className="logo">
      <Crewmate color={color} size={size} />
      <div className="logo-text">
        Among Us<small>IRL</small>
      </div>
    </div>
  );
}
