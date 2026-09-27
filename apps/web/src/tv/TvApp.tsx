import type { PublicMeeting, PublicPlayer, ServerToClientPayloads, TvView } from "@among-us/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { playAlarm, playVictory, unlockAudio } from "../lib/audio";
import { AlarmOverlay, GameOverBlock, meetingReason, ResultBlock, SUBPHASE_LABEL, type AlarmInfo } from "../lib/game";
import { useGameConnection } from "../lib/socket";
import { Crewmate } from "../lib/crewmate";
import { ConnectionBanner, Countdown, Logo, QrCode } from "../lib/ui";
import "./tv.css";

export function TvApp() {
  const [alarm, setAlarm] = useState<AlarmInfo | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  /** Keeps the last vote result on screen for a moment when the game ends right after it. */
  const [lingeringResult, setLingeringResult] = useState<PublicMeeting | null>(null);
  const viewRef = useRef<TvView | null>(null);

  const onEvent = useCallback((name: string, payload: unknown) => {
    if (name === "meeting:called") {
      playAlarm();
      setAlarm(payload as ServerToClientPayloads["meeting:called"]);
    } else if (name === "meeting:result") {
      const meeting = viewRef.current?.meeting;
      if (meeting) setLingeringResult({ ...meeting, subPhase: "RESULT", result: payload as ServerToClientPayloads["meeting:result"] });
    } else if (name === "game:over") {
      playVictory();
    }
  }, []);

  const { view, connected } = useGameConnection(() => ({ tv: true }), onEvent);
  const tv = view?.kind === "tv" ? view : null;
  viewRef.current = tv;

  useEffect(() => {
    if (!alarm) return;
    const t = setTimeout(() => setAlarm(null), 6000);
    return () => clearTimeout(t);
  }, [alarm]);

  useEffect(() => {
    if (!lingeringResult) return;
    const t = setTimeout(() => setLingeringResult(null), 8000);
    return () => clearTimeout(t);
  }, [lingeringResult]);

  return (
    <div className="tv">
      <ConnectionBanner connected={connected} />
      {tv && <TvContent view={tv} lingeringResult={lingeringResult} />}
      {alarm && <AlarmOverlay alarm={alarm} players={tv?.players ?? []} large />}
      {!soundOn && (
        <button
          className="tv-sound"
          onClick={() => {
            unlockAudio();
            setSoundOn(true);
          }}
        >
          Cliquer pour activer le son
        </button>
      )}
    </div>
  );
}

function TvContent({ view, lingeringResult }: { view: TvView; lingeringResult: PublicMeeting | null }) {
  if (view.phase === "GAME_OVER" && lingeringResult?.result) {
    return (
      <div className="tv-center">
        <ResultBlock meeting={lingeringResult} players={view.players} large />
      </div>
    );
  }

  switch (view.phase) {
    case "LOBBY":
      return <Lobby view={view} />;
    case "ROLE_REVEAL":
      return (
        <div className="tv-center">
          <div className="tv-lineup">
            {view.players.map((p) => (
              <Crewmate key={p.id} color={p.color} size={70} />
            ))}
          </div>
          <div className="tv-huge">Découvrez votre rôle</div>
          <p className="tv-sub">Cachez votre écran et maintenez le doigt appuyé</p>
          <Countdown endsAt={view.phaseEndsAt} className="tv-timer" />
        </div>
      );
    case "PLAYING":
      return (
        <div className="tv-center tv-calm">
          <div className="tv-huge">Partie en cours</div>
          <p className="tv-sub">En cas de réunion, rendez-vous au point de rassemblement</p>
        </div>
      );
    case "MEETING":
      return view.meeting ? <Meeting view={view} meeting={view.meeting} /> : null;
    case "GAME_OVER":
      return view.gameOver ? (
        <div className="tv-page">
          <GameOverBlock info={view.gameOver} large />
        </div>
      ) : null;
  }
}

function Lobby({ view }: { view: TvView }) {
  const ready = view.players.filter((p) => p.ready).length;
  return (
    <div className="tv-lobby">
      <div className="tv-qr">
        <Logo size={64} />
        <div className="tv-qr-card">
          <QrCode value={view.joinUrl} size={560} />
        </div>
        <div className="tv-url">{view.joinUrl}</div>
        <p className="tv-sub">Scannez pour rejoindre la partie</p>
      </div>
      <div className="tv-players">
        <div className="row spread">
          <div className="title">Équipage</div>
          <div className="tv-count">
            {ready} / {view.players.length} prêts
          </div>
        </div>
        <PlayerGrid players={view.players} mark={(p) => p.ready} />
        {view.players.length < view.params.minPlayers && (
          <p className="tv-sub">Encore {view.params.minPlayers - view.players.length} joueur(s) minimum</p>
        )}
      </div>
    </div>
  );
}

function PlayerGrid({ players, mark, strike }: { players: PublicPlayer[]; mark?: (p: PublicPlayer) => boolean; strike?: boolean }) {
  return (
    <ul className="tv-grid">
      {players.map((p) => {
        const dead = strike && p.dead;
        const marked = mark?.(p);
        return (
          <li key={p.id} className={`${dead ? "dead" : ""}${marked ? " marked" : ""}`}>
            <Crewmate color={p.color} size={52} variant={dead ? "ghost" : "alive"} />
            <span className="tv-name">{p.name}</span>
            {marked && <span className="pill-ok">✓</span>}
            {dead && <span className="tv-dead-tag">mort</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Meeting({ view, meeting }: { view: TvView; meeting: PublicMeeting }) {
  const alive = view.players.filter((p) => meeting.alive.includes(p.id));
  return (
    <div className="tv-page">
      <div className="tv-meeting-head">
        <div>
          <div className="tv-phase">{SUBPHASE_LABEL[meeting.subPhase]}</div>
          <div className="tv-sub">{meetingReason(meeting, view.players)}</div>
        </div>
        <Countdown endsAt={meeting.endsAt} className="tv-timer" />
      </div>

      {meeting.subPhase === "GATHERING" && (
        <>
          <div className="title">
            Arrivés : {meeting.arrived.length} / {meeting.alive.length}
          </div>
          <PlayerGrid players={alive} mark={(p) => meeting.arrived.includes(p.id)} />
        </>
      )}
      {meeting.subPhase === "DISCUSSION" && <PlayerGrid players={view.players} strike />}
      {meeting.subPhase === "VOTING" && (
        <>
          <div className="title">
            Votes : {meeting.voted.length} / {meeting.alive.length}
          </div>
          <PlayerGrid players={alive} mark={(p) => meeting.voted.includes(p.id)} />
        </>
      )}
      {meeting.subPhase === "RESULT" && (
        <div className="tv-result">
          <ResultBlock meeting={meeting} players={view.players} large />
          <div className="title center">
            Dispersez-vous : reprise dans <Countdown endsAt={meeting.endsAt} unit />
          </div>
        </div>
      )}
    </div>
  );
}
