import { SKIP_VOTE, type PlayerView, type PublicMeeting, type PublicPlayer } from "@among-us/shared";
import { useState } from "react";
import { meetingReason, ResultBlock, SUBPHASE_LABEL } from "../lib/game";
import { Countdown, PlayerChip, playerById } from "../lib/ui";
import type { Send } from "./PlayerApp";

function MeetingHeader({ view, meeting }: { view: PlayerView; meeting: PublicMeeting }) {
  return (
    <div className="stack">
      <div className="row spread">
        <span className="badge">{SUBPHASE_LABEL[meeting.subPhase]}</span>
        <Countdown endsAt={meeting.endsAt} className="timer-chip" />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {meetingReason(meeting, view.players)}
      </p>
    </div>
  );
}

function Roster({ view, meeting, showArrivals, showVotes }: { view: PlayerView; meeting: PublicMeeting; showArrivals?: boolean; showVotes?: boolean }) {
  return (
    <ul className="plist">
      {view.players.map((p) => {
        const mark = showArrivals
          ? meeting.arrived.includes(p.id)
          : showVotes
            ? meeting.voted.includes(p.id)
            : false;
        return (
          <li key={p.id}>
            <PlayerChip player={p} strike={p.dead} />
            {p.dead ? <span className="muted small">mort</span> : mark ? <span className="check">✓</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function MeetingScreen({ view, send }: { view: PlayerView; send: Send }) {
  const meeting = view.meeting;
  if (!meeting) return null;
  if (view.me.status !== "ALIVE") return <GhostMeeting view={view} meeting={meeting} />;

  return (
    <div className="screen">
      <MeetingHeader view={view} meeting={meeting} />
      {meeting.subPhase === "GATHERING" && <Gathering view={view} meeting={meeting} send={send} />}
      {meeting.subPhase === "DISCUSSION" && (
        <>
          <div className="title">Qui est l'imposteur ?</div>
          <Roster view={view} meeting={meeting} />
        </>
      )}
      {meeting.subPhase === "VOTING" && <Voting view={view} meeting={meeting} send={send} />}
      {meeting.subPhase === "RESULT" && <Result view={view} meeting={meeting} />}
    </div>
  );
}

function Gathering({ view, meeting, send }: { view: PlayerView; meeting: PublicMeeting; send: Send }) {
  const arrived = meeting.arrived.includes(view.me.id);
  return (
    <>
      <div className="panel stack" style={{ textAlign: "center" }}>
        <div className="title">Rendez-vous au point de rassemblement</div>
        <p className="muted">
          Arrivés : {meeting.arrived.length} / {meeting.alive.length}
        </p>
      </div>
      {arrived ? (
        <div className="panel center big check">Arrivé ✓ En attente des autres</div>
      ) : (
        <button className="btn ok huge" onClick={() => send("player:arrived")}>
          Je suis arrivé
        </button>
      )}
      <Roster view={view} meeting={meeting} showArrivals />
    </>
  );
}

function Voting({ view, meeting, send }: { view: PlayerView; meeting: PublicMeeting; send: Send }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const hasVoted = meeting.voted.includes(view.me.id);
  const candidates = view.players.filter((p) => meeting.alive.includes(p.id));

  if (hasVoted) {
    return (
      <>
        <div className="panel center big check">Vote enregistré ✓</div>
        <p className="muted">
          Votes : {meeting.voted.length} / {meeting.alive.length}
        </p>
        <Roster view={view} meeting={meeting} showVotes />
      </>
    );
  }

  const label = choice === SKIP_VOTE ? "Passer" : playerById(view.players, choice ?? undefined)?.name;
  return (
    <>
      <div className="title">Qui éjecter ?</div>
      <div className="stack vote-list">
        {candidates.map((p) => (
          <button key={p.id} type="button" className={choice === p.id ? "selected" : ""} onClick={() => setChoice(p.id)}>
            <PlayerChip player={p} />
            {meeting.voted.includes(p.id) && <span className="muted small">a voté</span>}
          </button>
        ))}
        <button type="button" className={choice === SKIP_VOTE ? "selected" : ""} onClick={() => setChoice(SKIP_VOTE)}>
          <strong>Passer</strong>
        </button>
      </div>
      <button className="btn" disabled={!choice} onClick={() => setConfirming(true)}>
        Valider mon vote
      </button>
      {confirming && choice && (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="big">{choice === SKIP_VOTE ? "Passer le vote ?" : `Voter contre ${label} ?`}</div>
            <p className="muted">Ton vote est définitif.</p>
            <button
              className="btn danger"
              onClick={async () => {
                setConfirming(false);
                await send("player:vote", { targetId: choice });
              }}
            >
              Confirmer
            </button>
            <button className="btn secondary" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Result({ view, meeting }: { view: PlayerView; meeting: PublicMeeting }) {
  return (
    <>
      <ResultBlock meeting={meeting} players={view.players} />
      <div className="panel center">
        <div className="title">Dispersez-vous</div>
        <p className="muted">
          Reprise dans <Countdown endsAt={meeting.endsAt} /> s
        </p>
      </div>
    </>
  );
}

function GhostMeeting({ view, meeting }: { view: PlayerView; meeting: PublicMeeting }) {
  const cemetery = view.params.ghostMeetingMode === "cemetery";
  return (
    <div className="screen">
      <MeetingHeader view={view} meeting={meeting} />
      <div className="panel stack" style={{ textAlign: "center" }}>
        <div className="title">{cemetery ? "Rejoins le cimetière" : "Rejoins le point de rassemblement"}</div>
        <p className="muted">Tu es un fantôme : tu ne parles pas et tu ne votes pas.</p>
      </div>
      {meeting.subPhase === "RESULT" ? (
        <>
          <ResultBlock meeting={meeting} players={view.players} />
          <p className="muted center">
            Reprise dans <Countdown endsAt={meeting.endsAt} /> s
          </p>
        </>
      ) : (
        !cemetery && <SpectatorList players={view.players} meeting={meeting} />
      )}
    </div>
  );
}

function SpectatorList({ players, meeting }: { players: PublicPlayer[]; meeting: PublicMeeting }) {
  return (
    <ul className="plist">
      {players.map((p) => (
        <li key={p.id}>
          <PlayerChip player={p} strike={p.dead} />
          {meeting.subPhase === "VOTING" && meeting.voted.includes(p.id) && <span className="check">✓</span>}
        </li>
      ))}
    </ul>
  );
}
