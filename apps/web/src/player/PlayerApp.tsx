import type { AnonymousView, PlayerView, PublicMeeting, SabotageKind, ServerToClientPayloads, StationAccess, StationId } from "@among-us/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { playAlarm, playPowerDown, playRepaired, playSabotageAlarm, playVictory } from "../lib/audio";
import { AlarmOverlay, ResultBlock, type AlarmInfo } from "../lib/game";
import { getSession, setSession } from "../lib/session";
import { useGameConnection } from "../lib/socket";
import { SabotageAlert } from "../lib/stations";
import { ConnectionBanner, useToast } from "../lib/ui";
import { useNow } from "../lib/clock";
import { vibrate, VIBRATION } from "../lib/vibration";
import { armDeviceFeatures, needsGesture } from "../lib/wakeLock";
import { BodyScreen, GameOverScreen, GhostScreen, JoinScreen, LobbyScreen, PlayingScreen, RoleRevealScreen } from "./screens";
import { MeetingScreen } from "./meeting";
import { StationScreen, type OpenStation } from "./station";

/** Sends a command; resolves to the ack data (or true), or false after showing the error. */
export type Send = <T = unknown>(name: string, payload?: unknown) => Promise<boolean | T>;

/**
 * The player's phone. `stationToken` is set when the page was opened by scanning a station's
 * QR code (`/s/:token`): the station screen then opens over the game.
 */
export function PlayerApp({ stationToken }: { stationToken?: string }) {
  const [toast, showToast] = useToast();
  const [bodyQr, setBodyQr] = useState<ServerToClientPayloads["body:qr"] | null>(null);
  const [alarm, setAlarm] = useState<AlarmInfo | null>(null);
  const [sabotageAlert, setSabotageAlert] = useState<SabotageKind | null>(null);
  const [station, setStation] = useState<OpenStation | null>(null);
  /** Keeps the vote result on screen for a moment when that vote ends the game. */
  const [lingeringResult, setLingeringResult] = useState<PublicMeeting | null>(null);
  const viewRef = useRef<PlayerView | AnonymousView | null>(null);

  const onEvent = useCallback(
    (name: string, payload: unknown) => {
      switch (name) {
        case "player:session":
          setSession((payload as { token: string }).token);
          break;
        case "player:kicked":
          setSession(null);
          showToast("Le maître du jeu vous a retiré de la partie", "info");
          break;
        case "body:qr":
          setBodyQr(payload as ServerToClientPayloads["body:qr"]);
          break;
        case "kill:ready":
          vibrate(VIBRATION.killReady);
          break;
        case "meeting:called": {
          const m = payload as ServerToClientPayloads["meeting:called"];
          playAlarm();
          vibrate(VIBRATION.alarm);
          setAlarm(m);
          break;
        }
        case "meeting:result": {
          const meeting = viewRef.current?.meeting;
          if (meeting) setLingeringResult({ ...meeting, subPhase: "RESULT", result: payload as ServerToClientPayloads["meeting:result"] });
          break;
        }
        case "sabotage:started": {
          const { kind } = payload as ServerToClientPayloads["sabotage:started"];
          if (kind === "lights") {
            playPowerDown();
            vibrate(VIBRATION.blackout);
          } else {
            playSabotageAlarm();
            vibrate(VIBRATION.sabotage);
          }
          setSabotageAlert(kind);
          break;
        }
        case "sabotage:repaired":
          playRepaired();
          setSabotageAlert(null);
          showToast("Sabotage réparé", "info");
          break;
        case "game:over":
          playVictory();
          break;
      }
    },
    [showToast],
  );

  const { view, connected, send: rawSend } = useGameConnection(() => ({ sessionToken: getSession() ?? undefined }), onEvent);
  viewRef.current = view && (view.kind === "player" || view.kind === "anonymous") ? view : null;

  const armed = view?.kind === "player" && (view.me.ready || view.phase !== "LOBBY");
  useEffect(() => {
    if (armed) armDeviceFeatures();
  }, [armed]);

  useEffect(() => {
    if (!lingeringResult) return;
    const t = setTimeout(() => setLingeringResult(null), 7000);
    return () => clearTimeout(t);
  }, [lingeringResult]);

  useEffect(() => {
    if (!alarm) return;
    const t = setTimeout(() => setAlarm(null), 5000);
    return () => clearTimeout(t);
  }, [alarm]);

  useEffect(() => {
    if (!sabotageAlert) return;
    const t = setTimeout(() => setSabotageAlert(null), 3500);
    return () => clearTimeout(t);
  }, [sabotageAlert]);

  const send = useCallback(
    async <T,>(name: string, payload?: unknown): Promise<boolean | T> => {
      const res = await rawSend<T>(name, payload);
      if (!res.ok) {
        showToast(res.error.message);
        return false;
      }
      return res.data ?? true;
    },
    [rawSend, showToast],
  ) as Send;

  const closeStation = useCallback(() => {
    setStation(null);
    if (location.pathname !== "/") history.replaceState(null, "", "/" + location.search);
  }, []);

  const openStation = useCallback(
    async (at: StationAccess): Promise<boolean> => {
      const res = await rawSend<{ stationId: StationId }>("station:open", { at });
      if (!res.ok || !res.data) {
        if (!res.ok) showToast(res.error.message);
        return false;
      }
      setStation({ id: res.data.stationId, at });
      return true;
    },
    [rawSend, showToast],
  );

  // A scanned station opens once the player's session is known.
  const isPlayer = view?.kind === "player" && connected;
  const scannedRef = useRef(false);
  useEffect(() => {
    if (!stationToken || !isPlayer || scannedRef.current) return;
    scannedRef.current = true;
    void openStation({ token: stationToken }).then((ok) => ok || closeStation());
  }, [stationToken, isPlayer, openStation, closeStation]);

  // Stations only make sense during play: a meeting or the end of the game closes them.
  const phase = view?.phase;
  useEffect(() => {
    if (station && phase !== "PLAYING") closeStation();
  }, [station, phase, closeStation]);

  let content: React.ReactNode;
  if (!view) {
    content = (
      <div className="screen center">
        <p className="muted">Connexion…</p>
      </div>
    );
  } else if (view.kind === "anonymous") {
    content = stationToken ? (
      <StationWithoutSession />
    ) : view.phase === "LOBBY" ? (
      <JoinScreen view={view} send={send} />
    ) : (
      <div className="screen center">
        <div className="title">Partie en cours</div>
        <p className="muted">Attendez la prochaine partie. Si vous jouiez déjà, rouvrez le lien dans le navigateur utilisé pour rejoindre.</p>
      </div>
    );
  } else if (view.kind === "player") {
    content =
      view.phase === "GAME_OVER" && lingeringResult?.result ? (
        <div className="screen center">
          <ResultBlock meeting={lingeringResult} players={view.players} />
          <p className="muted center">Fin de la partie…</p>
        </div>
      ) : station && view.phase === "PLAYING" && view.me.status !== "BODY" ? (
        <StationScreen view={view} station={station} send={send} onClose={closeStation} />
      ) : (
        <PlayerScreens view={view} send={send} bodyQr={bodyQr} openStation={openStation} />
      );
  } else {
    content = null;
  }

  return (
    <>
      <ConnectionBanner connected={connected} />
      {armed && <GestureBanner />}
      {content}
      {sabotageAlert && !alarm && <SabotageAlert kind={sabotageAlert} onClose={() => setSabotageAlert(null)} />}
      {alarm && <AlarmOverlay alarm={alarm} players={viewRef.current?.players ?? []} onClose={() => setAlarm(null)} />}
      {toast}
    </>
  );
}

function PlayerScreens({
  view,
  send,
  bodyQr,
  openStation,
}: {
  view: PlayerView;
  send: Send;
  bodyQr: ServerToClientPayloads["body:qr"] | null;
  openStation: (at: StationAccess) => Promise<boolean>;
}) {
  const { me } = view;
  switch (view.phase) {
    case "LOBBY":
      return <LobbyScreen view={view} send={send} />;
    case "ROLE_REVEAL":
      return <RoleRevealScreen view={view} />;
    case "PLAYING":
      if (me.status === "BODY") return <BodyScreen view={view} qr={bodyQr} />;
      if (me.status === "GHOST") return <GhostScreen view={view} send={send} openStation={openStation} />;
      return <PlayingScreen view={view} send={send} openStation={openStation} />;
    case "MEETING":
      return <MeetingScreen view={view} send={send} />;
    case "GAME_OVER":
      return <GameOverScreen view={view} />;
  }
}

/** A station QR opened in a browser that does not hold the player's session. */
function StationWithoutSession() {
  return (
    <div className="screen center">
      <div className="big">Ouvrez ce lien dans le navigateur avec lequel vous avez rejoint la partie</div>
      <p className="muted">
        Plus simple : dans le jeu, touchez « Code d'une station » et tapez les 4 chiffres imprimés sous le QR de la station.
      </p>
      <input className="input" readOnly value={location.href} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

/** Shown after a reload: sound and the keep-awake lock need one tap to come back. */
function GestureBanner() {
  useNow(1000);
  if (!needsGesture()) return null;
  return <div className="gesture-banner">Touchez l'écran pour réactiver le son et l'écran allumé</div>;
}
