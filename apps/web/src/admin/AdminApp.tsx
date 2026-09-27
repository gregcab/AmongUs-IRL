import { SKIP_VOTE, type AdminView, type GameParams, type Player, type PlayerStatus, type Team } from "@among-us/shared";
import { useCallback, useState } from "react";
import { formatClock, secondsLeft, useNow } from "../lib/clock";
import { GameOverBlock, meetingReason, ROLE_LABEL, SUBPHASE_LABEL } from "../lib/game";
import { getAdminToken, setAdminToken } from "../lib/session";
import { useGameConnection } from "../lib/socket";
import { ConnectionBanner, Countdown, Logo, PlayerChip, useToast } from "../lib/ui";
import { ParamsForm } from "./ParamsForm";
import "./admin.css";

type AdminPlayer = Omit<Player, "sessionToken">;

const STATUS_LABEL: Record<PlayerStatus, string> = {
  ALIVE: "Vivant",
  DYING: "Mourant",
  BODY: "Corps",
  GHOST: "Fantôme",
};

const PHASE_LABEL: Record<AdminView["phase"], string> = {
  LOBBY: "Lobby",
  ROLE_REVEAL: "Révélation des rôles",
  PLAYING: "En jeu",
  MEETING: "Réunion",
  GAME_OVER: "Partie terminée",
};

export type AdminSend = (name: string, payload?: unknown) => Promise<boolean>;

export function AdminApp() {
  const [toast, showToast] = useToast();
  const [authed, setAuthed] = useState(false);
  const { view, connected, send: rawSend, reconnect } = useGameConnection(() => ({ adminToken: getAdminToken() ?? undefined }));

  const send: AdminSend = useCallback(
    async (name, payload) => {
      const res = await rawSend(name, payload);
      if (!res.ok) showToast(res.error.message);
      return res.ok;
    },
    [rawSend, showToast],
  );

  const login = async (pin: string) => {
    const res = await rawSend<{ adminToken: string }>("admin:auth", { pin });
    if (!res.ok) return showToast(res.error.message);
    if (res.data) setAdminToken(res.data.adminToken);
    setAuthed(true);
  };

  const admin = view?.kind === "admin" ? view : null;
  return (
    <div className="admin">
      <ConnectionBanner connected={connected} />
      {admin ? (
        <Dashboard view={admin} send={send} onLogout={() => (setAdminToken(null), setAuthed(false), reconnect())} />
      ) : (
        <Login onSubmit={login} pending={authed} />
      )}
      {toast}
    </div>
  );
}

function Login({ onSubmit, pending }: { onSubmit: (pin: string) => void; pending: boolean }) {
  const [pin, setPin] = useState("");
  return (
    <form
      className="screen center"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(pin);
      }}
    >
      <Logo />
      <div className="big">Console du maître du jeu</div>
      <input className="input" type="password" inputMode="numeric" autoFocus placeholder="Code" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button className="btn" disabled={!pin || pending}>
        Entrer
      </button>
    </form>
  );
}

function Dashboard({ view, send, onLogout }: { view: AdminView; send: AdminSend; onLogout: () => void }) {
  const s = view.state;
  const confirmThen = (message: string, name: string, payload?: unknown) => {
    if (window.confirm(message)) void send(name, payload);
  };

  return (
    <div className="admin-page">
      <header className="admin-head">
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <strong className="big">{PHASE_LABEL[view.phase]}</strong>
          {view.meeting && <span className="badge">{SUBPHASE_LABEL[view.meeting.subPhase]}</span>}
          {view.phaseEndsAt && <Countdown endsAt={view.phaseEndsAt} className="countdown big" />}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a className="btn secondary small-btn" href="/tv" target="_blank" rel="noreferrer">
            Ouvrir la TV
          </a>
          <a className="btn secondary small-btn" href="/api/print/emergency" target="_blank" rel="noreferrer">
            QR d'urgence (imprimer)
          </a>
          <button className="btn secondary small-btn" onClick={onLogout}>
            Déconnexion
          </button>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel stack">
          <Actions view={view} send={send} confirmThen={confirmThen} />
        </section>

        <section className="panel stack">
          <h3>Journal</h3>
          <ul className="admin-log">
            {[...s.log].reverse().map((entry, i) => (
              <li key={s.log.length - i}>
                <span className="muted">{formatClock(entry.at)}</span> {entry.text}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel stack admin-wide">
          <PlayersTable view={view} send={send} confirmThen={confirmThen} />
        </section>

        {view.phase === "LOBBY" && (
          <section className="panel stack">
            <h3>Paramètres</h3>
            <ParamsForm params={s.params} onSave={(params: Partial<GameParams>) => send("admin:updateParams", { params })} />
          </section>
        )}

        {view.meeting && (
          <section className="panel stack">
            <MeetingPanel view={view} />
          </section>
        )}

        {view.gameOver && (
          <section className="panel stack">
            <GameOverBlock info={view.gameOver} />
          </section>
        )}

      </div>
    </div>
  );
}

function Actions({
  view,
  send,
  confirmThen,
}: {
  view: AdminView;
  send: AdminSend;
  confirmThen: (message: string, name: string, payload?: unknown) => void;
}) {
  const s = view.state;
  const now = useNow(500);
  const players = Object.values(s.players);
  const notReady = players.filter((p) => !p.ready).length;

  return (
    <>
      <h3>Actions</h3>
      <p className="muted small">
        Joueurs : <strong>{view.joinUrl}</strong>
      </p>
      {view.phase === "LOBBY" && (
        <>
          <button className="btn ok" onClick={() => send("admin:start", {})}>
            Lancer la partie
          </button>
          {notReady > 0 && (
            <button className="btn secondary" onClick={() => confirmThen(`${notReady} joueur(s) pas prêt(s). Lancer quand même ?`, "admin:start", { force: true })}>
              Forcer le lancement
            </button>
          )}
        </>
      )}
      {(view.phase === "PLAYING" || view.phase === "MEETING") && (
        <div className="stack small">
          <div>
            Cooldown kill :{" "}
            {s.killCooldownEndsAt === undefined ? (
              <span className="muted">{view.phase === "MEETING" ? "gelé" : "—"}</span>
            ) : now >= s.killCooldownEndsAt ? (
              <strong className="role-impostor">kill disponible</strong>
            ) : (
              <strong>{secondsLeft(s.killCooldownEndsAt, now)} s</strong>
            )}
          </div>
          <div>
            Cooldown urgence :{" "}
            {s.emergencyCooldownEndsAt === undefined || now >= s.emergencyCooldownEndsAt ? (
              <span className="muted">disponible</span>
            ) : (
              <strong>{secondsLeft(s.emergencyCooldownEndsAt, now)} s</strong>
            )}
          </div>
        </div>
      )}
      {view.phase === "PLAYING" && (
        <button className="btn danger" onClick={() => confirmThen("Appeler une réunion maintenant ?", "admin:callMeeting", {})}>
          Appeler une réunion
        </button>
      )}
      {(view.phase === "ROLE_REVEAL" || view.phase === "MEETING") && (
        <button className="btn" onClick={() => send("admin:advancePhase")}>
          Phase suivante
        </button>
      )}
      {(view.phase === "ROLE_REVEAL" || view.phase === "PLAYING" || view.phase === "MEETING") && (
        <div className="row">
          {(["crew", "impostors"] as Team[]).map((winner) => (
            <button
              key={winner}
              className="btn secondary small-btn"
              onClick={() => confirmThen(`Terminer la partie : victoire ${winner === "crew" ? "des équipiers" : "des imposteurs"} ?`, "admin:endGame", { winner })}
            >
              Victoire {winner === "crew" ? "équipiers" : "imposteurs"}
            </button>
          ))}
        </div>
      )}
      {view.phase === "GAME_OVER" && (
        <button className="btn" onClick={() => send("admin:backToLobby")}>
          Retour au lobby (rejouer)
        </button>
      )}
    </>
  );
}

function PlayersTable({
  view,
  send,
  confirmThen,
}: {
  view: AdminView;
  send: AdminSend;
  confirmThen: (message: string, name: string, payload?: unknown) => void;
}) {
  const s = view.state;
  const now = useNow(500);
  const players = Object.values(s.players).sort((a, b) => a.joinedAt - b.joinedAt) as AdminPlayer[];
  const inGame = view.phase !== "LOBBY";

  const rename = (p: AdminPlayer) => {
    const name = window.prompt(`Nouveau pseudo pour ${p.name}`, p.name);
    if (name && name !== p.name) void send("admin:rename", { playerId: p.id, name });
  };

  return (
    <>
      <h3>Joueurs ({players.length})</h3>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Joueur</th>
              {inGame ? (
                <>
                  <th>Rôle</th>
                  <th>Statut</th>
                  <th>Urgences</th>
                </>
              ) : (
                <th>Prêt</th>
              )}
              <th>Connexion</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>
                  <PlayerChip player={p} />
                </td>
                {inGame ? (
                  <>
                    <td className={p.role === "impostor" ? "role-impostor" : "role-crew"}>{p.role ? ROLE_LABEL[p.role] : "—"}</td>
                    <td>
                      {STATUS_LABEL[p.status]}
                      {p.ejected && " (éjecté)"}
                      {p.status === "DYING" && p.dyingEffectiveAt && <span className="muted"> · {secondsLeft(p.dyingEffectiveAt, now)} s</span>}
                    </td>
                    <td>
                      {p.emergencyUsed} / {s.params.emergencyMeetingsPerPlayer}
                    </td>
                  </>
                ) : (
                  <td>{p.ready ? <span className="check">✓</span> : "—"}</td>
                )}
                <td>{p.connected ? <span className="check">en ligne</span> : <span className="muted">hors ligne</span>}</td>
                <td className="actions">
                  <button className="btn secondary small-btn" onClick={() => rename(p)}>
                    Renommer
                  </button>
                  {view.phase === "LOBBY" && (
                    <button className="btn secondary small-btn" onClick={() => confirmThen(`Exclure ${p.name} ?`, "admin:kick", { playerId: p.id })}>
                      Exclure
                    </button>
                  )}
                  {(view.phase === "PLAYING" || view.phase === "MEETING") && (p.status === "ALIVE" || p.status === "DYING") && (
                    <button className="btn secondary small-btn" onClick={() => confirmThen(`Déclarer ${p.name} mort immédiatement ?`, "admin:declareDeath", { playerId: p.id })}>
                      Tuer
                    </button>
                  )}
                  {view.phase === "PLAYING" && (p.status === "BODY" || p.status === "DYING") && (
                    <button className="btn secondary small-btn" onClick={() => confirmThen(`Signaler le corps de ${p.name} ?`, "admin:callMeeting", { bodyOfId: p.id })}>
                      Signaler
                    </button>
                  )}
                  {(view.phase === "PLAYING" || view.phase === "MEETING") &&
                    (p.status === "DYING" || p.status === "BODY" || (p.status === "GHOST" && !p.ejected)) && (
                      <button className="btn secondary small-btn" onClick={() => confirmThen(`Réanimer ${p.name} ?`, "admin:revive", { playerId: p.id })}>
                        Réanimer
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MeetingPanel({ view }: { view: AdminView }) {
  const meeting = view.state.meeting;
  if (!meeting) return null;
  const name = (id: string) => view.state.players[id]?.name ?? "?";
  const alive = Object.values(view.state.players).filter((p) => p.status === "ALIVE");
  return (
    <>
      <h3>Réunion</h3>
      <p>{meetingReason(meeting, view.players)}</p>
      <p className="small">
        Arrivés : {meeting.arrived.length} / {alive.length} · Votes : {Object.keys(meeting.votes).length} / {alive.length}
      </p>
      <ul className="plist small">
        {Object.entries(meeting.votes).map(([voter, target]) => (
          <li key={voter}>
            <span>{name(voter)}</span>
            <span>→ {target === SKIP_VOTE ? "passer" : name(target)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
