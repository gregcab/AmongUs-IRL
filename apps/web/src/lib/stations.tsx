import {
  OXYGEN_CODE_STATIONS,
  SABOTAGE_STATIONS,
  stationDef,
  type PublicSabotage,
  type SabotageKind,
  type Station,
  type StationId,
} from "@among-us/shared";
import { secondsLeft, formatSeconds, useNow } from "./clock";

export function stationById(stations: Station[], id: StationId): Station {
  return stations.find((s) => s.id === id) ?? { id, name: stationDef(id).name, location: "" };
}

export function StationName({ station }: { station: Station }) {
  return (
    <span className="station-name">
      <strong>{station.name}</strong>
      {station.location && <span className="station-loc"> · {station.location}</span>}
    </span>
  );
}

export const SABOTAGE_TITLE: Record<PublicSabotage["kind"], string> = {
  reactor: "Réacteur en fusion",
  oxygen: "Oxygène épuisé",
  lights: "Panne de courant",
  comms: "Communications coupées",
};

/** What to do about the current sabotage, with the live repair status. Shared by phones and the TV. */
export function SabotageInfo({ sabotage, stations, large }: { sabotage: PublicSabotage; stations: Station[]; large?: boolean }) {
  const now = useNow(250);
  const st = (id: StationId) => stationById(stations, id);
  const left = sabotage.endsAt !== undefined ? secondsLeft(sabotage.endsAt, now) : undefined;
  // Critical sabotages: the oxygen level drains, the reactor heats up, over the countdown.
  const remaining =
    sabotage.endsAt !== undefined && sabotage.endsAt > sabotage.startedAt
      ? Math.min(1, Math.max(0, (sabotage.endsAt - now) / (sabotage.endsAt - sabotage.startedAt)))
      : undefined;
  return (
    <div className={`sabotage-info sabotage-${sabotage.kind}${large ? " large" : ""}`}>
      <div className="sabotage-head">
        <span className="sabotage-title">{SABOTAGE_TITLE[sabotage.kind]}</span>
        {left !== undefined && <span className="sabotage-timer">{formatSeconds(left)}</span>}
      </div>
      {remaining !== undefined && <CriticalGauge kind={sabotage.kind} remaining={remaining} />}
      {sabotage.kind === "reactor" && (
        <>
          <p className="sabotage-text">Deux joueurs : un doigt en même temps sur chaque station Réacteur.</p>
          <ul className="sabotage-status">
            {SABOTAGE_STATIONS.reactor.map((id) => (
              <li key={id} className={sabotage.held?.includes(id) ? "done" : ""}>
                <StationName station={st(id)} />
                <span>{sabotage.held?.includes(id) ? "main posée" : "personne"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {sabotage.kind === "oxygen" && (
        <>
          <p className="sabotage-text">
            Allez aux deux stations O2 et tapez le code affiché.
          </p>
          <ul className="sabotage-status">
            {OXYGEN_CODE_STATIONS.map((id) => (
              <li key={id} className={sabotage.entered?.includes(id) ? "done" : ""}>
                <StationName station={st(id)} />
                <span>{sabotage.entered?.includes(id) ? "code validé" : "en attente"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {sabotage.kind === "comms" && (
        <p className="sabotage-text">
          Réglez la radio à <StationName station={st("comms")} />. Tâches impossibles en attendant (sauf pour les fantômes).
        </p>
      )}
      {sabotage.kind === "lights" && (
        <>
          <p className="sabotage-text">
            Remettez les interrupteurs à <StationName station={st("electrical")} />. Impossible de signaler un corps en attendant.
          </p>
          <ul className="sabotage-status">
            <li className={sabotage.switches?.every(Boolean) ? "done" : ""}>
              <span>Interrupteurs</span>
              <span>
                {sabotage.switches?.filter(Boolean).length ?? 0} / {sabotage.switches?.length ?? 0}
              </span>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

/** Oxygen level (drains to 0 %) or reactor temperature (rises to 100 %) of a critical sabotage. */
function CriticalGauge({ kind, remaining }: { kind: SabotageKind; remaining: number }) {
  const level = kind === "oxygen" ? remaining : 1 - remaining;
  const percent = Math.round(level * 100);
  return (
    <div className={`critical-gauge critical-${kind}`}>
      <div className="critical-gauge-label">
        <span>{kind === "oxygen" ? "Oxygène" : "Température du réacteur"}</span>
        <strong>{percent} %</strong>
      </div>
      <div className="critical-gauge-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${level * 100}%` }} />
      </div>
    </div>
  );
}

/** Brief full-screen alert when a sabotage starts; the banner then stays on screen. */
export function SabotageAlert({ kind, onClose }: { kind: SabotageKind; onClose?: () => void }) {
  return (
    <div className={`sabotage-alert sabotage-alert-${kind}`} onClick={onClose}>
      <div className="sabotage-alert-eyebrow">Sabotage</div>
      <div className="sabotage-alert-title">{SABOTAGE_TITLE[kind]}</div>
    </div>
  );
}
