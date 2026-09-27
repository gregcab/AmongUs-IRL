import { SABOTAGE_LABEL, type PlayerView, type SabotageKind } from "@among-us/shared";
import { secondsLeft, useNow } from "../lib/clock";
import type { Send } from "./PlayerApp";

const SABOTAGE_HINT: Record<SabotageKind, (seconds: number) => string> = {
  reactor: (s) => `Critique : ${s} s pour poser un doigt sur les deux stations Réacteur`,
  oxygen: (s) => `Critique : ${s} s pour taper les deux codes O2`,
  lights: () => "Bloque les signalements de corps jusqu'à la réparation",
};

/** Slide target inside the impostor's role card: releasing the finger on it opens the menu. */
export function SabotageTarget({ view }: { view: PlayerView }) {
  const now = useNow(500);
  if (view.phase !== "PLAYING" || view.params.enabledSabotages.length === 0) return null;
  const wait = secondsLeft(view.sabotageCooldownEndsAt, now);
  return (
    <div className="sabotage-target" data-reveal-action="sabotage">
      <span className="sabotage-target-icon" aria-hidden>
        ⚡
      </span>
      <span>
        Glisse ici et relâche pour saboter
        {view.sabotage ? <small>Sabotage en cours</small> : wait > 0 ? <small>Disponible dans {wait} s</small> : null}
      </span>
    </div>
  );
}

export function SabotageMenu({ view, send, onClose }: { view: PlayerView; send: Send; onClose: () => void }) {
  const now = useNow(500);
  const wait = secondsLeft(view.sabotageCooldownEndsAt, now);
  const blocked = view.phase !== "PLAYING" || view.sabotage !== undefined || wait > 0;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sabotage-menu" onClick={(e) => e.stopPropagation()}>
        <div className="big">Sabotage</div>
        <p className="muted" style={{ margin: 0 }}>
          {view.sabotage
            ? `Sabotage en cours : ${SABOTAGE_LABEL[view.sabotage.kind]}`
            : wait > 0
              ? `Disponible dans ${wait} s (délai commun aux imposteurs)`
              : "Tous les téléphones et la TV donneront l'alerte. Cache ton écran."}
        </p>
        {view.params.enabledSabotages.map((kind) => (
          <button
            key={kind}
            className="btn danger sabotage-choice"
            disabled={blocked}
            onClick={async () => {
              if (await send("player:sabotage", { kind })) onClose();
            }}
          >
            <span>{SABOTAGE_LABEL[kind]}</span>
            <small>{SABOTAGE_HINT[kind](view.params.sabotageCriticalSeconds)}</small>
          </button>
        ))}
        <button className="btn secondary" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
