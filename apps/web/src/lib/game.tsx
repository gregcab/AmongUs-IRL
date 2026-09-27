import { SKIP_VOTE, type GameOverInfo, type MeetingSubPhase, type PublicMeeting, type PublicPlayer, type Role } from "@among-us/shared";
import { formatClock } from "./clock";
import { ColorDot, PlayerChip, playerById } from "./ui";

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
  m: { type: PublicMeeting["type"]; reporterId?: string; bodyOfId?: string },
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

export function ResultBlock({ meeting, players, large }: { meeting: PublicMeeting; players: PublicPlayer[]; large?: boolean }) {
  const result = meeting.result;
  if (!result) return null;
  const ejected = playerById(players, result.ejectedId ?? undefined);
  return (
    <div className="stack">
      {ejected ? (
        <div className={large ? "title" : "big"}>
          <PlayerChip player={ejected} /> a été éjecté
        </div>
      ) : (
        <div className={large ? "title" : "big"}>Personne n'a été éjecté</div>
      )}
      {ejected && result.role && (
        <div className={`big ${result.role === "impostor" ? "role-impostor" : "role-crew"}`}>
          {ejected.name} {result.role === "impostor" ? "était un imposteur" : "n'était pas un imposteur"}
        </div>
      )}
      {result.tally && <Tally tally={result.tally} players={players} />}
    </div>
  );
}

function Tally({ tally, players }: { tally: Record<string, string>; players: PublicPlayer[] }) {
  const byTarget = new Map<string, string[]>();
  for (const [voter, target] of Object.entries(tally)) byTarget.set(target, [...(byTarget.get(target) ?? []), voter]);
  const entries = [...byTarget].sort((a, b) => b[1].length - a[1].length);
  if (entries.length === 0) return <p className="muted">Aucun vote</p>;
  return (
    <ul className="plist">
      {entries.map(([target, voters]) => {
        const t = playerById(players, target);
        return (
          <li key={target}>
            <span>{target === SKIP_VOTE ? <strong>Passer</strong> : t ? <PlayerChip player={t} /> : "?"}</span>
            <span className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              <strong>{voters.length}</strong>
              {voters.map((v) => {
                const p = playerById(players, v);
                return p ? (
                  <span key={v} title={p.name}>
                    <ColorDot color={p.color} size={14} />
                  </span>
                ) : null;
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GameOverBlock({ info, large }: { info: GameOverInfo; large?: boolean }) {
  const name = (id: string) => info.roles.find((r) => r.id === id);
  return (
    <div className="stack">
      <div className={`${large ? "title" : "big"} winner-${info.winner}`} style={large ? { fontSize: "3.4rem" } : undefined}>
        {info.winner === "crew" ? "Victoire des équipiers" : "Victoire des imposteurs"}
      </div>
      <h3>Rôles</h3>
      <ul className="plist">
        {info.roles.map((r) => (
          <li key={r.id}>
            <PlayerChip player={r} />
            <strong className={r.role === "impostor" ? "role-impostor" : "role-crew"}>{ROLE_LABEL[r.role]}</strong>
          </li>
        ))}
      </ul>
      {info.timeline.length > 0 && (
        <>
          <h3>Chronologie</h3>
          <ul className="plist">
            {info.timeline.map((t, i) => {
              const p = name(t.playerId);
              const what = t.kind === "death" ? "mort" : t.kind === "ejection" ? "éjecté" : "réanimé par le MJ";
              return (
                <li key={i}>
                  <span className="muted">{formatClock(t.at)}</span>
                  <span className="row">
                    {p ? <PlayerChip player={p} /> : "?"} <span>{what}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
