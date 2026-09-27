import type { AnonymousView, PlayerView, ServerToClientPayloads } from "@among-us/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { playAlarm, playVictory } from "../lib/audio";
import { AlarmOverlay, type AlarmInfo } from "../lib/game";
import { getSession, setSession } from "../lib/session";
import { useGameConnection } from "../lib/socket";
import { ConnectionBanner, useToast } from "../lib/ui";
import { useNow } from "../lib/clock";
import { vibrate, VIBRATION } from "../lib/vibration";
import { armDeviceFeatures, needsGesture } from "../lib/wakeLock";
import { BodyScreen, GameOverScreen, GhostScreen, JoinScreen, LobbyScreen, PlayingScreen, RoleRevealScreen } from "./screens";
import { MeetingScreen } from "./meeting";

/** Sends a command; resolves to the ack data (or true), or false after showing the error. */
export type Send = <T = unknown>(name: string, payload?: unknown) => Promise<boolean | T>;

interface Alarm {
  text: string;
  title: string;
}

export function PlayerApp() {
  const [toast, showToast] = useToast();
  const [bodyQr, setBodyQr] = useState<ServerToClientPayloads["body:qr"] | null>(null);
  const [alarm, setAlarm] = useState<AlarmInfo | null>(null);
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
    if (!alarm) return;
    const t = setTimeout(() => setAlarm(null), 5000);
    return () => clearTimeout(t);
  }, [alarm]);

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

  let content: React.ReactNode;
  if (!view) {
    content = (
      <div className="screen center">
        <p className="muted">Connexion…</p>
      </div>
    );
  } else if (view.kind === "anonymous") {
    content =
      view.phase === "LOBBY" ? (
        <JoinScreen view={view} send={send} />
      ) : (
        <div className="screen center">
          <div className="title">Partie en cours</div>
          <p className="muted">Attendez la prochaine partie. Si vous jouiez déjà, rouvrez le lien dans le navigateur utilisé pour rejoindre.</p>
        </div>
      );
  } else if (view.kind === "player") {
    content = <PlayerScreens view={view} send={send} bodyQr={bodyQr} />;
  } else {
    content = null;
  }

  return (
    <>
      <ConnectionBanner connected={connected} />
      {armed && <GestureBanner />}
      {content}
      {alarm && <AlarmOverlay alarm={alarm} players={viewRef.current?.players ?? []} onClose={() => setAlarm(null)} />}
      {toast}
    </>
  );
}

function PlayerScreens({ view, send, bodyQr }: { view: PlayerView; send: Send; bodyQr: ServerToClientPayloads["body:qr"] | null }) {
  const { me } = view;
  switch (view.phase) {
    case "LOBBY":
      return <LobbyScreen view={view} send={send} />;
    case "ROLE_REVEAL":
      return <RoleRevealScreen view={view} />;
    case "PLAYING":
      if (me.status === "BODY") return <BodyScreen view={view} qr={bodyQr} />;
      if (me.status === "GHOST") return <GhostScreen view={view} />;
      return <PlayingScreen view={view} send={send} />;
    case "MEETING":
      return <MeetingScreen view={view} send={send} />;
    case "GAME_OVER":
      return <GameOverScreen view={view} />;
  }
}

/** Shown after a reload: sound and the keep-awake lock need one tap to come back. */
function GestureBanner() {
  useNow(1000);
  if (!needsGesture()) return null;
  return <div className="gesture-banner">Touchez l'écran pour réactiver le son et l'écran allumé</div>;
}
