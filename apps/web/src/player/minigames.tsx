import { DATA_TRANSFER_MS, FUEL_HOLD_MS } from "@among-us/shared";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { playClick, playError, playNote, playSuccess } from "../lib/audio";
import { capture, HoldButton } from "../lib/ui";

// Single-player task mini-games. They run on the phone only: winning one sends the
// task step to the server. Crewmates and impostors play exactly the same games.

interface GameProps {
  onDone: () => void;
}

function randomInt(n: number): number {
  return Math.floor(Math.random() * n);
}

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Calls `onDone` once, after a short pause so the player sees the success state. */
function useFinish(onDone: () => void): [boolean, () => void] {
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!finished) return;
    playSuccess();
    const t = setTimeout(() => doneRef.current(), 600);
    return () => clearTimeout(t);
  }, [finished]);
  return [finished, useCallback(() => setFinished(true), [])];
}

// ---------------------------------------------------------------------------
// Brancher les câbles
// ---------------------------------------------------------------------------

const WIRE_COLORS = [
  { id: "red", hex: "#ff3b47" },
  { id: "blue", hex: "#3b8bff" },
  { id: "yellow", hex: "#ffd23b" },
  { id: "pink", hex: "#ff5fd0" },
] as const;
const WIRE_ROW = 72;
const WIRES_HEIGHT = WIRE_ROW * WIRE_COLORS.length;
const wireHex = (id: string) => WIRE_COLORS.find((c) => c.id === id)!.hex;

export function Wires({ onDone }: GameProps) {
  const [left] = useState(() => shuffle(WIRE_COLORS));
  const [right] = useState(() => {
    let order = shuffle(WIRE_COLORS);
    while (order.every((c, i) => c.id === left[i]!.id)) order = shuffle(WIRE_COLORS);
    return order;
  });
  const [linked, setLinked] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDragState] = useState<{ color: string; x: number; y: number } | null>(null);
  // Events can arrive before a re-render: handlers read the drag from a ref.
  const dragRef = useRef(drag);
  const setDrag = (value: typeof drag) => {
    dragRef.current = value;
    setDragState(value);
  };
  const [finished, finish] = useFinish(onDone);
  const box = useRef<HTMLDivElement>(null);

  const local = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * WIRES_HEIGHT };
  };
  const rowOf = (order: readonly { id: string }[], id: string) => order.findIndex((c) => c.id === id) * WIRE_ROW + WIRE_ROW / 2;

  const connect = (color: string, plug: string) => {
    if (plug !== color) {
      playError();
      return;
    }
    playClick();
    setLinked((prev) => (prev.includes(color) ? prev : [...prev, color]));
    setSelected(null);
  };
  useEffect(() => {
    if (linked.length === WIRE_COLORS.length) finish();
  }, [linked, finish]);

  return (
    <div className="minigame stack center">
      <div
        ref={box}
        className="wires"
        style={{ height: WIRES_HEIGHT }}
        onPointerMove={(e) => dragRef.current && setDrag({ ...dragRef.current, ...local(e) })}
        onPointerUp={(e) => {
          const current = dragRef.current;
          if (!current) return;
          const plug = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-plug]");
          if (plug) connect(current.color, plug.dataset.plug!);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <svg className="wires-svg" viewBox={`0 0 100 ${WIRES_HEIGHT}`} preserveAspectRatio="none" aria-hidden>
          {linked.map((id) => (
            <line key={id} x1={12} y1={rowOf(left, id)} x2={88} y2={rowOf(right, id)} stroke={wireHex(id)} strokeWidth={12} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {drag && (
            <line x1={12} y1={rowOf(left, drag.color)} x2={drag.x} y2={drag.y} stroke={wireHex(drag.color)} strokeWidth={12} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {left.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-label={`Fil ${i + 1}`}
            data-wire={c.id}
            className={`wire-end left${selected === c.id ? " selected" : ""}${linked.includes(c.id) ? " linked" : ""}`}
            style={{ top: i * WIRE_ROW + WIRE_ROW / 2, background: c.hex }}
            onPointerDown={(e) => {
              if (linked.includes(c.id)) return;
              if (box.current) capture(box.current, e.pointerId);
              setSelected(c.id);
              setDrag({ color: c.id, ...local(e) });
            }}
          />
        ))}
        {right.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-label={`Prise ${i + 1}`}
            data-plug={c.id}
            className={`wire-end right${linked.includes(c.id) ? " linked" : ""}`}
            style={{ top: i * WIRE_ROW + WIRE_ROW / 2, background: c.hex }}
            onClick={() => selected && connect(selected, c.id)}
          />
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {finished ? "Câbles branchés !" : "Glisse chaque fil vers la prise de même couleur (ou touche le fil, puis la prise)."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code du coffre
// ---------------------------------------------------------------------------

const SAFE_DIGITS = 5;
const SAFE_SHOW_MS = 3000;
const newSafeCode = () => Array.from({ length: SAFE_DIGITS }, () => String(randomInt(10))).join("");

export function SafeCode({ onDone }: GameProps) {
  const [code, setCode] = useState(newSafeCode);
  const [mode, setMode] = useState<"show" | "input" | "wrong">("show");
  const [typed, setTyped] = useState("");
  const [finished, finish] = useFinish(onDone);

  useEffect(() => {
    if (mode !== "show") return;
    const t = setTimeout(() => setMode("input"), SAFE_SHOW_MS);
    return () => clearTimeout(t);
  }, [mode, code]);

  const press = (key: string) => {
    if (mode !== "input" || finished) return;
    playClick();
    if (key === "del") return setTyped((t) => t.slice(0, -1));
    const next = typed + key;
    setTyped(next);
    if (next.length < SAFE_DIGITS) return;
    if (next === code) return finish();
    playError();
    setMode("wrong");
    // A new code each try.
    setTimeout(() => {
      setCode(newSafeCode());
      setTyped("");
      setMode("show");
    }, 1200);
  };

  const shown = mode === "show" ? code : typed.padEnd(SAFE_DIGITS, " ");
  return (
    <div className="minigame stack">
      <div className={`safe-display${mode === "wrong" ? " wrong" : ""}${finished ? " ok" : ""}`}>
        {[...shown].map((d, i) => (
          <span key={i}>{d.trim() || "·"}</span>
        ))}
      </div>
      <div className="safe-status">
        {finished ? "Coffre ouvert !" : mode === "show" ? "Mémorise le code…" : mode === "wrong" ? "Code faux : nouveau code" : "Tape le code"}
        {mode === "show" && <span key={code} className="safe-timer" />}
      </div>
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0"].map((k) => (
          <button key={k} type="button" className={k === "del" ? "del" : ""} disabled={mode !== "input" || finished} onClick={() => press(k)}>
            {k === "del" ? "⌫" : k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibrer le distributeur
// ---------------------------------------------------------------------------

const GAUGES = 3;
const ZONE_WIDTH = 20;

function useFrame(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

export function Distributor({ onDone }: GameProps) {
  const [zones] = useState(() => Array.from({ length: GAUGES }, () => 10 + Math.random() * (80 - ZONE_WIDTH)));
  const [stops, setStops] = useState<number[]>([]);
  const [miss, setMiss] = useState(false);
  const [finished, finish] = useFinish(onDone);
  const startedAt = useRef(performance.now());
  const index = stops.length;
  const now = useFrame(!finished);
  // The cursor bounces faster on each gauge.
  const period = 1500 - index * 300;
  const cursor = (t: number) => {
    const phase = ((t - startedAt.current) % (2 * period)) / period;
    return (phase < 1 ? phase : 2 - phase) * 100;
  };

  const stop = () => {
    if (finished || index >= GAUGES) return;
    const at = cursor(performance.now());
    const zone = zones[index]!;
    startedAt.current = performance.now();
    if (at < zone || at > zone + ZONE_WIDTH) {
      playError();
      setMiss(true);
      setTimeout(() => setMiss(false), 350);
      return;
    }
    playNote(523 + index * 131);
    setStops([...stops, at]);
    if (index + 1 === GAUGES) finish();
  };

  return (
    <div className="minigame stack">
      {zones.map((zone, i) => (
        <div key={i} className={`gauge${i === index && miss ? " miss" : ""}${i < index ? " locked" : ""}`}>
          <span className="gauge-zone" style={{ left: `${zone}%`, width: `${ZONE_WIDTH}%` }} />
          {i <= index && <span className="gauge-cursor" style={{ left: `${i < index ? stops[i] : cursor(now)}%` }} />}
        </div>
      ))}
      <button type="button" className="btn huge" disabled={finished} onPointerDown={stop}>
        {finished ? "Distributeur calibré !" : `Stop (jauge ${index + 1}/${GAUGES})`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Réacteur (Simon)
// ---------------------------------------------------------------------------

const SIMON_PADS = [
  { color: "#2fd08a", note: 392 },
  { color: "#ff3b47", note: 494 },
  { color: "#ffd23b", note: 587 },
  { color: "#3b8bff", note: 698 },
];
const SIMON_LENGTH = 5;
const newSequence = () => Array.from({ length: SIMON_LENGTH }, () => randomInt(SIMON_PADS.length));

export function Simon({ onDone }: GameProps) {
  const [sequence, setSequence] = useState(newSequence);
  const [round, setRound] = useState(1);
  const [mode, setMode] = useState<"watch" | "play" | "error">("watch");
  const [position, setPosition] = useState(0);
  const [lit, setLit] = useState<number | null>(null);
  const [finished, finish] = useFinish(onDone);

  useEffect(() => {
    if (mode !== "watch") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    sequence.slice(0, round).forEach((pad, i) => {
      timers.push(
        setTimeout(() => {
          setLit(pad);
          playNote(SIMON_PADS[pad]!.note, 0.35);
        }, 800 + i * 650),
      );
      timers.push(setTimeout(() => setLit(null), 800 + i * 650 + 420));
    });
    timers.push(
      setTimeout(() => {
        setPosition(0);
        setMode("play");
      }, 800 + round * 650),
    );
    return () => timers.forEach(clearTimeout);
  }, [mode, round, sequence]);

  const tap = (pad: number) => {
    if (mode !== "play" || finished) return;
    setLit(pad);
    setTimeout(() => setLit((l) => (l === pad ? null : l)), 180);
    if (sequence[position] !== pad) {
      // A mistake starts over with a new sequence.
      playError();
      setMode("error");
      setTimeout(() => {
        setSequence(newSequence());
        setRound(1);
        setMode("watch");
      }, 1300);
      return;
    }
    playNote(SIMON_PADS[pad]!.note, 0.2);
    if (position + 1 < round) return setPosition(position + 1);
    if (round === SIMON_LENGTH) return finish();
    setRound(round + 1);
    setMode("watch");
  };

  return (
    <div className="minigame stack">
      <div className="simon-status">
        {finished ? "Réacteur démarré !" : mode === "watch" ? `Regarde… (${round}/${SIMON_LENGTH})` : mode === "play" ? `À toi ! (${round}/${SIMON_LENGTH})` : "Erreur : on recommence"}
      </div>
      <div className="simon">
        {SIMON_PADS.map((pad, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Couleur ${i + 1}`}
            className={`simon-pad${lit === i ? " lit" : ""}`}
            style={{ background: pad.color }}
            disabled={mode !== "play" || finished}
            onPointerDown={() => tap(i)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Télécharger puis envoyer les données
// ---------------------------------------------------------------------------

export function DataTransfer({ upload, onDone }: GameProps & { upload: boolean }) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [finished, finish] = useFinish(onDone);
  const now = useFrame(startedAt !== null && !finished);
  const progress = startedAt === null ? (finished ? 1 : 0) : Math.min(1, (now - startedAt) / DATA_TRANSFER_MS);

  useEffect(() => {
    if (startedAt === null) return;
    // The phone must stay unlocked: hiding the page interrupts the transfer.
    const onHidden = () => {
      if (document.visibilityState === "visible") return;
      setStartedAt(null);
      setInterrupted(true);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [startedAt]);

  useEffect(() => {
    if (startedAt !== null && progress >= 1) {
      setStartedAt(null);
      finish();
    }
  }, [startedAt, progress, finish]);

  const seconds = Math.ceil(((1 - progress) * DATA_TRANSFER_MS) / 1000);
  return (
    <div className="minigame stack center">
      <div className={`transfer${upload ? " upload" : ""}`}>
        <span className="transfer-icon" aria-hidden>
          {upload ? "📡" : "💾"}
        </span>
        <div className="transfer-bar">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <strong>{Math.floor(progress * 100)} %</strong>
      </div>
      {finished ? (
        <div className="big check">{upload ? "Données envoyées !" : "Données téléchargées !"}</div>
      ) : startedAt === null ? (
        <>
          {interrupted && <p className="warn-text">Transfert interrompu : garde l'écran allumé et recommence.</p>}
          <button
            type="button"
            className="btn huge"
            onClick={() => {
              setInterrupted(false);
              setStartedAt(performance.now());
            }}
          >
            {upload ? "Envoyer les données" : "Télécharger les données"}
          </button>
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {upload ? "Envoi" : "Téléchargement"} en cours : encore {seconds} s. Garde l'écran allumé.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remplir le moteur
// ---------------------------------------------------------------------------

export function FuelHold({ empty, onDone }: GameProps & { empty: boolean }) {
  const [finished, finish] = useFinish(onDone);
  return (
    <div className="minigame stack center">
      <div className={`fuel-can${finished ? (empty ? " empty" : " full") : empty ? " full" : ""}`} aria-hidden>
        <span />
      </div>
      {finished ? (
        <div className="big check">{empty ? "Moteur rempli !" : "Bidon rempli !"}</div>
      ) : (
        <HoldButton
          className="fuel-hold"
          label={empty ? "Maintenir pour vider le bidon" : "Maintenir pour remplir le bidon"}
          holdingLabel={empty ? "Vidage…" : "Remplissage…"}
          durationMs={FUEL_HOLD_MS}
          onComplete={finish}
        />
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {FUEL_HOLD_MS / 1000} s sans lâcher : relâcher remet la jauge à zéro.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte d'accès
// ---------------------------------------------------------------------------

const CARD_MIN_MS = 500;
const CARD_MAX_MS = 1500;

export function CardSwipe({ onDone }: GameProps) {
  const track = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; t0: number } | null>(null);
  const [x, setX] = useState(0);
  const xRef = useRef(0);
  const [message, setMessage] = useState("Glisse la carte jusqu'au bout, d'un geste régulier.");
  const [finished, finish] = useFinish(onDone);

  const move = (value: number) => {
    xRef.current = value;
    setX(value);
  };
  const travel = () => (track.current?.clientWidth ?? 300) - (card.current?.offsetWidth ?? 110);

  return (
    <div className="minigame stack center">
      <div ref={track} className={`card-slot${finished ? " ok" : ""}`}>
        <span className="card-slot-light" />
        <div
          ref={card}
          className="access-card"
          style={{ transform: `translateX(${(x / 100) * travel()}px)` }}
          onPointerDown={(e) => {
            if (finished) return;
            capture(e.currentTarget, e.pointerId);
            drag.current = { startX: e.clientX - (xRef.current / 100) * travel(), t0: performance.now() };
            move(0);
            setMessage("…");
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            move(Math.max(0, Math.min(100, ((e.clientX - drag.current.startX) / travel()) * 100)));
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (!d || finished) return;
            const elapsed = performance.now() - d.t0;
            const verdict =
              xRef.current < 95 ? "Glisse la carte jusqu'au bout." : elapsed < CARD_MIN_MS ? "Trop vite ! Recommence." : elapsed > CARD_MAX_MS ? "Trop lent… Recommence." : null;
            if (verdict) {
              playError();
              setMessage(verdict);
              move(0);
              return;
            }
            setMessage("Carte acceptée !");
            finish();
          }}
          onPointerCancel={() => {
            drag.current = null;
            move(0);
          }}
        >
          <span className="access-card-chip" />
          ACCÈS
        </div>
      </div>
      <p className={finished ? "big check" : "muted"} style={{ margin: 0 }}>
        {message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aligner l'antenne (variante curseur, sans gyroscope)
// ---------------------------------------------------------------------------

const ANTENNA_TOLERANCE = 4;

export function Antenna({ onDone }: GameProps) {
  const [target] = useState(() => (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 55));
  const [angle, setAngle] = useState(0);
  const [finished, finish] = useFinish(onDone);
  const gap = Math.abs(angle - target);
  const aligned = gap <= ANTENNA_TOLERANCE;
  const bars = Math.max(0, 5 - Math.floor(gap / 8));

  useEffect(() => {
    if (!aligned || finished) return;
    // Hold the alignment for a second.
    const t = setTimeout(finish, 1000);
    return () => clearTimeout(t);
  }, [aligned, finished, finish]);

  const point = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: 100 + r * Math.cos(rad), y: 110 + r * Math.sin(rad) };
  };
  const tip = point(angle, 82);
  const mark = point(target, 92);
  return (
    <div className="minigame stack center">
      <svg className={`antenna${aligned ? " aligned" : ""}`} viewBox="0 0 200 124" aria-hidden>
        <path d="M 12 110 A 88 88 0 0 1 188 110" className="antenna-arc" />
        <circle cx={mark.x} cy={mark.y} r={9} className="antenna-target" />
        <line x1={100} y1={110} x2={tip.x} y2={tip.y} className="antenna-arrow" />
        <circle cx={100} cy={110} r={7} className="antenna-hub" />
      </svg>
      <div className="signal" aria-label={`Signal ${bars} sur 5`}>
        {[1, 2, 3, 4, 5].map((b) => (
          <span key={b} className={b <= bars ? "on" : ""} style={{ height: 6 + b * 5 }} />
        ))}
      </div>
      <input
        className="antenna-slider"
        type="range"
        min={-90}
        max={90}
        step={1}
        value={angle}
        disabled={finished}
        aria-label="Orientation de l'antenne"
        onChange={(e) => setAngle(Number(e.target.value))}
      />
      <p className={finished ? "big check" : "muted"} style={{ margin: 0 }}>
        {finished ? "Antenne alignée !" : aligned ? "Signal trouvé : ne bouge plus…" : "Fais glisser le curseur pour pointer la cible."}
      </p>
    </div>
  );
}
