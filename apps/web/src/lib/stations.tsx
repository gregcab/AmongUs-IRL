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
};

/** What to do about the current sabotage, with the live repair status. Shared by phones and the TV. */
export function SabotageInfo({ sabotage, stations, large }: { sabotage: PublicSabotage; stations: Station[]; large?: boolean }) {
  const now = useNow(250);
  const st = (id: StationId) => stationById(stations, id);
  const left = sabotage.endsAt !== undefined ? secondsLeft(sabotage.endsAt, now) : undefined;
  return (
    <div className={`sabotage-info sabotage-${sabotage.kind}${large ? " large" : ""}`}>
      <div className="sabotage-head">
        <span className="sabotage-title">{SABOTAGE_TITLE[sabotage.kind]}</span>
        {left !== undefined && <span className="sabotage-timer">{formatSeconds(left)}</span>}
      </div>
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
            Lisez les codes à <StationName station={st("admin")} />, puis tapez-les aux deux stations O2.
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

/** Brief full-screen alert when a sabotage starts; the banner then stays on screen. */
export function SabotageAlert({ kind, onClose }: { kind: SabotageKind; onClose?: () => void }) {
  return (
    <div className={`sabotage-alert sabotage-alert-${kind}`} onClick={onClose}>
      <div className="sabotage-alert-eyebrow">Sabotage</div>
      <div className="sabotage-alert-title">{SABOTAGE_TITLE[kind]}</div>
    </div>
  );
}
