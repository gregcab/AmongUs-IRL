import {
  SKIP_VOTE,
  type GameOverInfo,
  type MeetingSubPhase,
  type MeetingType,
  type PublicMeeting,
  type PublicPlayer,
  type Role,
} from "@among-us/shared";
import { formatClock } from "./clock";
import { Crewmate } from "./crewmate";
import { PlayerChip, playerById } from "./ui";

export const SUBPHASE_LABEL: Record<MeetingSubPhase, string> = {
  GATHERING: "Rassemblement",
  DISCUSSION: "Discussion",
  VOTING: "Vote",
  RESULT: "Résultat",
};

export const ROLE_LABEL: Record<Role, string> = {
  crew: "Équipier",
  impostor: "Imposteur",
};

export function meetingReason(
  m: { type: MeetingType; reporterId?: string; bodyOfId?: string },
  players: PublicPlayer[],
): string {
  const reporter = playerById(players, m.reporterId)?.name ?? "le MJ";
  if (m.type === "body") {
    const body = playerById(players, m.bodyOfId)?.name ?? "?";
    return `Corps de ${body} signalé par ${reporter}`;
  }
  if (m.type === "emergency") return `Réunion d'urgence appelée par ${reporter}`;
  return "Réunion appelée par le MJ";
}

export const PLAYER_RULES = [
  "Luminosité au maximum, ne verrouillez pas votre téléphone.",
  "Imposteur : pour tuer, posez deux doigts sur l'épaule de la victime en chuchotant « tu es mort ». Ne touchez jamais votre téléphone à ce moment-là.",
  "Victime : maintenez « Je suis mort », puis restez sur place, écran visible : votre téléphone devient votre corps.",
  "Pour signaler un corps, scannez son écran avec l'appareil photo de votre téléphone.",
  "Les fantômes ne parlent jamais aux vivants.",
];

export function RulesList() {
  return (
    <ul className="rules">
      {PLAYER_RULES.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

export interface AlarmInfo {
  type: MeetingType;
  reporterId?: string;
  bodyOfId?: string;
}

/** Full-screen meeting alarm, shared by phones and the TV. */
export function AlarmOverlay({ alarm, players, large, onClose }: { alarm: AlarmInfo; players: PublicPlayer[]; large?: boolean; onClose?: () => void }) {
  const reporter = playerById(players, alarm.reporterId);
  const body = playerById(players, alarm.bodyOfId);
  return (
    <div className={`alarm${large ? " large" : ""}`} onClick={onClose}>
      <div className="alarm-title">{alarm.type === "body" ? "Corps signalé" : "Réunion d'urgence"}</div>
      <div className="alarm-cast">
        {reporter && <Crewmate color={reporter.color} size={70} />}
        {body && <Crewmate color={body.color} size={70} variant="dead" />}
      </div>
      <div className="alarm-text">{meetingReason(alarm, players)}</div>
    </div>
  );
}

export function ResultBlock({ meeting, players, large }: { meeting: PublicMeeting; players: PublicPlayer[]; large?: boolean }) {
  const result = meeting.result;
  if (!result) return null;
  const ejected = playerById(players, result.ejectedId ?? undefined);
  return (
    <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
      {ejected && (
        <div className="eject-stage" style={{ width: "100%", height: large ? 220 : 130 }}>
          <Crewmate color={ejected.color} size={large ? 150 : 84} />
        </div>
      )}
      {ejected ? (
        <div className={large ? "title" : "big"} style={large ? { fontSize: "3rem" } : undefined}>
          {ejected.name} a été éjecté
        </div>
      ) : (
        <div className={large ? "title" : "big"} style={large ? { fontSize: "3rem" } : undefined}>
          Personne n'a été éjecté
        </div>
      )}
      {ejected && result.role && (
        <div className={`big ${result.role === "impostor" ? "role-impostor" : "role-crew"}`} style={large ? { fontSize: "2rem" } : undefined}>
          {ejected.name} {result.role === "impostor" ? "était un imposteur" : "n'était pas un imposteur"}
        </div>
      )}
      {result.tally && <Tally tally={result.tally} players={players} large={large} />}
    </div>
  );
}

function Tally({ tally, players, large }: { tally: Record<string, string>; players: PublicPlayer[]; large?: boolean }) {
  const byTarget = new Map<string, string[]>();
  for (const [voter, target] of Object.entries(tally)) byTarget.set(target, [...(byTarget.get(target) ?? []), voter]);
  const entries = [...byTarget].sort((a, b) => b[1].length - a[1].length);
  if (entries.length === 0) return <p className="muted">Aucun vote</p>;
  return (
    <ul className="plist" style={{ width: "100%", textAlign: "left" }}>
      {entries.map(([target, voters]) => {
        const t = playerById(players, target);
        return (
          <li key={target}>
            <span>{target === SKIP_VOTE ? <strong>Passer</strong> : t ? <PlayerChip player={t} size={large ? 40 : 24} /> : "?"}</span>
            <span className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end", gap: 4 }}>
              {voters.map((v) => {
                const p = playerById(players, v);
                return p ? (
                  <span key={v} title={p.name}>
                    <Crewmate color={p.color} size={large ? 34 : 18} />
                  </span>
                ) : null;
              })}
              <strong style={{ marginLeft: 6 }}>{voters.length}</strong>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GameOverBlock({ info, large }: { info: GameOverInfo; large?: boolean }) {
  const name = (id: string) => info.roles.find((r) => r.id === id);
  const winners = info.roles.filter((r) => (info.winner === "crew" ? r.role === "crew" : r.role === "impostor"));
  return (
    <div className="stack">
      <div className={`victory victory-${info.winner}`}>
        <span className="eyebrow">Fin de partie</span>
        <div className="victory-title" style={large ? { fontSize: "5.5rem" } : undefined}>
          Victoire
        </div>
        <div className={`big winner-${info.winner}`} style={large ? { fontSize: "2.4rem" } : undefined}>
          {info.winner === "crew" ? "des équipiers" : "des imposteurs"}
        </div>
        <div className="lineup">
          {winners.map((w) => (
            <Crewmate key={w.id} color={w.color} size={large ? 90 : 48} />
          ))}
        </div>
      </div>
      <div className={large ? "tv-gameover-grid" : "stack"}>
        <div className="panel stack">
          <span className="eyebrow">Rôles</span>
          <ul className="plist">
            {info.roles.map((r) => (
              <li key={r.id}>
                <PlayerChip player={r} />
                <strong className={r.role === "impostor" ? "role-impostor" : "role-crew"}>{ROLE_LABEL[r.role]}</strong>
              </li>
            ))}
          </ul>
        </div>
        {info.timeline.length > 0 && (
          <div className="panel stack">
            <span className="eyebrow">Chronologie</span>
            <ul className="plist">
              {info.timeline.map((t, i) => {
                const p = name(t.playerId);
                const what = t.kind === "death" ? "mort" : t.kind === "ejection" ? "éjecté" : "réanimé par le MJ";
                return (
                  <li key={i}>
                    <span className="muted countdown">{formatClock(t.at)}</span>
                    <span className="row">
                      {p ? <PlayerChip player={p} strike={t.kind !== "revive"} /> : "?"} <span className="muted">{what}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
