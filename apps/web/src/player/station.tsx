import {
  COMMS_DIAL_MAX,
  COMMS_TOLERANCE,
  OXYGEN_CODE_STATIONS,
  SABOTAGE_STATIONS,
  stationDef,
  type PlayerView,
  type StationAccess,
  type StationId,
} from "@among-us/shared";
import { useEffect, useRef, useState } from "react";
import { playClick } from "../lib/audio";
import { SabotageInfo, StationName, stationById } from "../lib/stations";
import { HoldPad } from "../lib/ui";
import type { Send } from "./PlayerApp";
import { TaskStation } from "./tasks";

export interface OpenStation {
  id: StationId;
  at: StationAccess;
  /** Server time of the opening: a task begun before a communications sabotage may finish. */
  openedAt: number;
}

/** Screen shown after scanning a station's QR code (or typing its code). */
export function StationScreen({ view, station, send, onClose }: { view: PlayerView; station: OpenStation; send: Send; onClose: () => void }) {
  const info = stationById(view.stations, station.id);
  const enabled = view.stations.some((s) => s.id === station.id);
  useEffect(() => {
    // Recent browsers make scrollTo return a promise: it must not be the effect's result.
    window.scrollTo(0, 0);
  }, [station.id]);
  return (
    <div className="screen station-screen">
      <div className="station-head">
        <span className="eyebrow">Station</span>
        <div className="title">{info.name}</div>
        {info.location && <div className="muted">{info.location}</div>}
      </div>
      {/* Wherever the player stands, the running sabotage stays in sight. */}
      {view.sabotage && <SabotageInfo sabotage={view.sabotage} stations={view.stations} />}
      {!enabled ? (
        <div className="panel center big">Station inactive pour cette partie.</div>
      ) : stationDef(station.id).task ? (
        <TaskStation view={view} station={station} send={send} />
      ) : (
        <StationContent view={view} station={station} send={send} />
      )}
      <button className="btn secondary" onClick={onClose}>
        Retour au jeu
      </button>
    </div>
  );
}

function StationContent({ view, station, send }: { view: PlayerView; station: OpenStation; send: Send }) {
  const kind = stationDef(station.id).sabotage;
  const sabotage = view.sabotage;
  const active = kind !== undefined && sabotage?.kind === kind;
  // Oxygen codes reach a player once they open an O2 or admin station: a screen opened before
  // the sabotage started opens the station again to get them.
  const needsCodes = active && kind === "oxygen" && !sabotage?.codes;
  const sabotageId = sabotage?.id;
  useEffect(() => {
    if (needsCodes) void send("station:open", { at: station.at });
  }, [needsCodes, sabotageId, send, station.at]);
  // A sabotage that ends while the player stands here was just repaired.
  const [repaired, setRepaired] = useState(false);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) setRepaired(true);
    if (active) setRepaired(false);
    wasActive.current = active;
  }, [active]);
  if (!active && repaired) {
    return (
      <div className="panel stack center station-idle">
        <span className="scan-ok-mark">✓</span>
        <div className="big">Réparé !</div>
      </div>
    );
  }
  if (!active) {
    return (
      <div className="panel stack center station-idle">
        <div className="big">Rien à réparer ici pour l'instant.</div>
        <p className="muted" style={{ margin: 0 }}>
          {sabotage ? "Le sabotage en cours se répare ailleurs : voir ci-dessus." : "En cas de sabotage, revenez scanner cette station."}
        </p>
      </div>
    );
  }
  const ghost = view.me.status === "GHOST";
  const repairUi =
    station.id === "admin" ? (
      <AdminCodes view={view} />
    ) : ghost ? (
      <div className="panel center big">Les fantômes ne réparent pas les sabotages.</div>
    ) : kind === "reactor" ? (
      <ReactorPad view={view} station={station} send={send} />
    ) : kind === "oxygen" ? (
      <OxygenCode view={view} station={station} send={send} />
    ) : kind === "comms" ? (
      <RadioDial view={view} station={station} send={send} />
    ) : (
      <LightSwitches view={view} station={station} send={send} />
    );
  return repairUi;
}

function ReactorPad({ view, station, send }: { view: PlayerView; station: OpenStation; send: Send }) {
  const other = SABOTAGE_STATIONS.reactor.find((id) => id !== station.id)!;
  const otherHeld = view.sabotage?.held?.includes(other) ?? false;
  return (
    <div className="panel stack center">
      <HoldPad
        className="reactor-pad"
        onHold={(holding) => {
          // Heartbeats stop once the reactor is repaired; the release is always sent.
          if (!holding || view.sabotage?.kind === "reactor") void send("station:hold", { at: station.at, holding });
        }}
      >
        {(holding) => (
          <>
            <span className="hand" aria-hidden>
              ✋
            </span>
            <span>{holding ? (otherHeld ? "Les deux mains sont posées !" : "Garde le doigt posé…") : "Pose ton doigt ici et garde-le"}</span>
          </>
        )}
      </HoldPad>
      <p className="muted" style={{ margin: 0 }}>
        Quelqu'un doit faire pareil en même temps à <StationName station={stationById(view.stations, other)} />.
      </p>
    </div>
  );
}

function OxygenCode({ view, station, send }: { view: PlayerView; station: OpenStation; send: Send }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const code = view.sabotage?.codes?.[station.id];
  const digits = typed.replace(/\D/g, "").slice(0, 4);
  const done = view.sabotage?.entered?.includes(station.id) ?? false;
  if (done) return <div className="panel center big check">Code validé ✓</div>;
  return (
    <form
      className="panel stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (digits.length !== 4) return;
        setBusy(true);
        const ok = await send("station:code", { at: station.at, code: digits });
        setBusy(false);
        if (!ok) setTyped("");
      }}
    >
      <div className="big">Code de cette station</div>
      <div className="o2-code">
        <span className="muted">Code à taper</span>
        <b>{code ?? "····"}</b>
      </div>
      <input
        className="input code-input"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0000"
        value={digits}
        onChange={(e) => setTyped(e.target.value)}
      />
      <button className="btn ok" disabled={busy || digits.length !== 4}>
        Valider le code
      </button>
    </form>
  );
}

function AdminCodes({ view }: { view: PlayerView }) {
  const codes = view.sabotage?.codes;
  return (
    <div className="panel stack">
      <span className="eyebrow">Codes de secours O2</span>
      {codes ? (
        <ul className="plist o2-codes">
          {OXYGEN_CODE_STATIONS.map((id) => (
            <li key={id}>
              <StationName station={stationById(view.stations, id)} />
              <b>{codes[id]}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Lecture des codes…</p>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Retiens-les ou note-les, puis tape chaque code à sa station.
      </p>
    </div>
  );
}

function LightSwitches({ view, station, send }: { view: PlayerView; station: OpenStation; send: Send }) {
  const switches = view.sabotage?.switches ?? [];
  return (
    <div className="panel stack center">
      <div className="big">Remets tous les interrupteurs sur ON</div>
      <div className="switches">
        {switches.map((on, i) => (
          <button
            key={i}
            type="button"
            className={`switch${on ? " on" : ""}`}
            aria-pressed={on}
            aria-label={`Interrupteur ${i + 1}`}
            onClick={() => {
              playClick();
              void send("station:switch", { at: station.at, index: i });
            }}
          >
            <span className="switch-knob" />
            <span className="switch-label">{on ? "ON" : "OFF"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Communications: turn the dial until the static clears, then hold it there for a second. */
function RadioDial({ view, station, send }: { view: PlayerView; station: OpenStation; send: Send }) {
  const target = view.sabotage?.frequency ?? 0;
  // Starts at the end of the dial farthest from the target.
  const [value, setValue] = useState(() => (target < COMMS_DIAL_MAX / 2 ? COMMS_DIAL_MAX : 0));
  const [busy, setBusy] = useState(false);
  const gap = Math.abs(value - target);
  const tuned = gap <= COMMS_TOLERANCE;
  const clarity = Math.max(0, 1 - gap / (COMMS_DIAL_MAX / 2));
  useEffect(() => {
    if (!tuned || busy) return;
    const t = setTimeout(async () => {
      setBusy(true);
      await send("station:tune", { at: station.at, frequency: value });
      setBusy(false);
    }, 1000);
    return () => clearTimeout(t);
  }, [tuned, busy, value, send, station.at]);
  // A sine wave buried in noise that fades as the dial gets closer.
  const points = Array.from({ length: 61 }, (_, i) => {
    const x = (i / 60) * 200;
    const noise = (1 - clarity) * 26 * Math.sin(i * 12.9898 + value * 78.233) * Math.sin(i * 4.1 + value);
    const y = 40 + clarity * 22 * Math.sin((i / 60) * Math.PI * 6) + noise;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const mhz = (88 + (value / COMMS_DIAL_MAX) * 20).toFixed(1);
  return (
    <div className="panel stack center">
      <div className="big">Règle la radio</div>
      <svg className={`radio-wave${tuned ? " tuned" : ""}`} viewBox="0 0 200 80" aria-hidden>
        <polyline points={points} />
      </svg>
      <div className="radio-freq">{mhz} MHz</div>
      <input
        className="antenna-slider"
        type="range"
        min={0}
        max={COMMS_DIAL_MAX}
        step={1}
        value={value}
        aria-label="Fréquence de la radio"
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <p className={tuned ? "check" : "muted"} style={{ margin: 0 }}>
        {tuned ? "Signal clair : ne bouge plus…" : "Tourne le bouton jusqu'à ce que le grésillement disparaisse."}
      </p>
    </div>
  );
}
