import { colorOf, PLAYER_COLORS, type AnonymousView, type PlayerView, type ServerToClientPayloads } from "@among-us/shared";
import { useState } from "react";
import { playReadyChime, unlockAudio } from "../lib/audio";
import { secondsLeft, useNow } from "../lib/clock";
import { Crewmate } from "../lib/crewmate";
import { GameOverBlock, ROLE_LABEL, RulesList } from "../lib/game";
import { setSession } from "../lib/session";
import { Countdown, HoldButton, HoldToReveal, Logo, PlayerChip, QrCode } from "../lib/ui";
import { canVibrate, vibrate, VIBRATION } from "../lib/vibration";
import { enableWakeLock } from "../lib/wakeLock";
import type { Send } from "./PlayerApp";

const DEATH_HOLD_MS = 1500;

function ColorPicker({ taken, value, onPick }: { taken: Set<string>; value?: string; onPick: (id: string) => void }) {
  return (
    <div className="swatches">
      {PLAYER_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`swatch${value === c.id ? " selected" : ""}`}
          disabled={taken.has(c.id) && value !== c.id}
          onClick={() => onPick(c.id)}
          aria-label={c.label}
        >
          <Crewmate color={c.id} size={34} />
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function JoinScreen({ view, send }: { view: AnonymousView; send: Send }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const taken = new Set(view.players.map((p) => p.color));
  const chosen = color && !taken.has(color) ? color : undefined;

  const submit = async () => {
    if (!chosen || !name.trim()) return;
    setBusy(true);
    const data = await send<{ token: string }>("lobby:join", { name: name.trim(), color: chosen });
    if (typeof data === "object" && data) setSession(data.token);
    setBusy(false);
  };

  return (
    <div className="screen">
      <Logo color={chosen ?? "red"} />
      <label className="stack" style={{ gap: 6 }}>
        <span className="field-label">Ton pseudo</span>
        <input
          className="input"
          value={name}
          maxLength={16}
          autoComplete="off"
          autoCapitalize="words"
          placeholder="Pseudo"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <span className="field-label">Ta couleur</span>
      <ColorPicker taken={taken} value={chosen} onPick={setColor} />
      <button className="btn" disabled={busy || !chosen || !name.trim()} onClick={submit}>
        Rejoindre la partie
      </button>
      <p className="muted small center">{view.players.length} joueur(s) déjà à bord</p>
    </div>
  );
}

export function LobbyScreen({ view, send }: { view: PlayerView; send: Send }) {
  const { me } = view;
  const taken = new Set(view.players.filter((p) => p.id !== me.id).map((p) => p.color));
  const [vibrationChecked, setVibrationChecked] = useState<boolean | null>(null);

  const onReady = async () => {
    unlockAudio();
    playReadyChime();
    enableWakeLock();
    if (canVibrate()) vibrate(VIBRATION.test);
    setVibrationChecked(canVibrate());
    await send("lobby:ready");
  };

  return (
    <div className="screen">
      <div className="row spread">
        <PlayerChip player={me} size={34} />
        {me.ready ? <span className="badge ok">Prêt</span> : <span className="badge">Pas prêt</span>}
      </div>

      {!me.ready ? (
        <>
          <span className="field-label">Changer de couleur</span>
          <ColorPicker taken={taken} value={me.color} onPick={(color) => color !== me.color && send("lobby:changeColor", { color })} />
          <button className="btn ok huge" onClick={onReady}>
            Je suis prêt
          </button>
          <p className="muted small center">Active le son, la vibration et garde l'écran allumé.</p>
        </>
      ) : (
        <div className="panel stack">
          <span className="eyebrow">Consignes</span>
          <RulesList />
          {vibrationChecked === false && <p className="muted small">Pas de vibration sur ce téléphone : surveille l'écran.</p>}
        </div>
      )}

      <div className="panel stack">
        <span className="eyebrow">Équipage ({view.players.length})</span>
        <ul className="plist">
          {view.players.map((p) => (
            <li key={p.id}>
              <PlayerChip player={p} />
              {p.ready ? <span className="pill-ok">✓</span> : <span className="muted small">en attente</span>}
            </li>
          ))}
        </ul>
      </div>
      {me.ready && <p className="muted center">En attente du lancement par le maître du jeu…</p>}
    </div>
  );
}

function RoleCard({ view }: { view: PlayerView }) {
  const role = view.me.role;
  if (!role) return null;
  return (
    <div className="role-card">
      <Crewmate color={view.me.color} size={86} />
      <span className="eyebrow">Tu es</span>
      <span className={`role-name ${role === "impostor" ? "role-impostor" : "role-crew"}`}>{ROLE_LABEL[role]}</span>
      {role === "impostor" && view.allies && view.allies.length > 0 && (
        <div className="stack" style={{ alignItems: "center", gap: 6 }}>
          <span className="eyebrow">Tes complices</span>
          {view.allies.map((a) => (
            <PlayerChip key={a.id} player={a} />
          ))}
        </div>
      )}
      {role === "impostor" && view.allies?.length === 0 && <span className="muted small">Tu es le seul imposteur</span>}
      {role === "crew" && <span className="muted small">Démasque les imposteurs</span>}
    </div>
  );
}

export function RoleRevealScreen({ view }: { view: PlayerView }) {
  return (
    <div className="screen">
      <div className="row spread">
        <PlayerChip player={view.me} />
        <Countdown endsAt={view.phaseEndsAt} className="timer-chip" />
      </div>
      <div className="title">Découvre ton rôle</div>
      <p className="muted" style={{ margin: 0 }}>
        Cache ton écran, puis maintiens le doigt appuyé.
      </p>
      <HoldToReveal className="big-pad grow" hint="Maintenir pour révéler">
        <RoleCard view={view} />
      </HoldToReveal>
    </div>
  );
}

/** Discreet state dot, identical for everyone except a tiny change when an impostor can kill. */
function StatusIndicator({ view }: { view: PlayerView }) {
  const now = useNow(500);
  const armed = view.killCooldownEndsAt !== undefined && now >= view.killCooldownEndsAt;
  return <span className={`indicator${armed ? " armed" : ""}`} aria-hidden />;
}

export function PlayingScreen({ view, send }: { view: PlayerView; send: Send }) {
  const { me, params } = view;
  const now = useNow(500);
  const dying = me.status === "DYING";
  const left = params.emergencyMeetingsPerPlayer - me.emergencyUsed;
  const emergencyIn = secondsLeft(view.emergencyCooldownEndsAt, now);

  return (
    <div className="screen">
      <div className="statusbar">
        <PlayerChip player={me} />
        <span className="row">
          {dying && <span className="muted small countdown">{secondsLeft(me.dyingEffectiveAt, now)}</span>}
          <StatusIndicator view={view} />
        </span>
      </div>

      <div className="panel hero grow">
        <Crewmate color={me.color} size={110} />
        <div className="big">Partie en cours</div>
        <p className="muted small" style={{ margin: 0 }}>
          Réunion d'urgence : {left > 0 ? `${left} restante(s)` : "aucune restante"}
          {left > 0 && emergencyIn > 0 ? ` · dispo dans ${emergencyIn} s` : ""}
        </p>
        {/* Extension point: task list (out of MVP scope). */}
      </div>

      <ReportByCode send={send} />

      <HoldToReveal hint="Maintenir pour voir ton rôle">
        <RoleCard view={view} />
      </HoldToReveal>

      <HoldButton
        label="Je suis mort"
        holdingLabel="Maintiens…"
        durationMs={DEATH_HOLD_MS}
        disabled={dying}
        onComplete={() => void send("player:declareDeath")}
      />
    </div>
  );
}

/** Fallback when the camera opens a browser without the session: type the code shown under the body's QR. */
function ReportByCode({ send }: { send: Send }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const digits = code.replace(/\D/g, "").slice(0, 4);

  const submit = async () => {
    setBusy(true);
    const ok = await send("player:reportCode", { code: digits });
    setBusy(false);
    if (ok) {
      setOpen(false);
      setCode("");
    }
  };

  return (
    <>
      <button type="button" className="btn secondary small-btn report-code-btn" onClick={() => setOpen(true)}>
        Signaler un corps avec son code
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (digits.length === 4) void submit();
            }}
          >
            <div className="big">Code du corps</div>
            <p className="muted" style={{ margin: 0 }}>
              Les 4 chiffres affichés sous le QR code du corps.
            </p>
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              placeholder="0000"
              value={digits}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn danger" disabled={busy || digits.length !== 4}>
              Signaler le corps
            </button>
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function BodyScreen({ view, qr }: { view: PlayerView; qr: ServerToClientPayloads["body:qr"] | null }) {
  const color = colorOf(view.me.color);
  const [size] = useState(() => Math.round(Math.min(window.innerWidth, window.innerHeight) * Math.min(2, window.devicePixelRatio || 1)));
  return (
    <div className="body-screen" style={{ borderColor: color.hex }}>
      <div className="row">
        <Crewmate color={view.me.color} size={30} variant="dead" />
        <span className="body-name">{view.me.name}</span>
      </div>
      {qr ? <QrCode value={qr.url} size={size} /> : <p>Génération du QR code…</p>}
      {qr && (
        <div className="body-code">
          Code <b>{qr.code}</b>
        </div>
      )}
      <p style={{ margin: 0, fontWeight: 600 }}>Tu es mort. Reste sur place, écran visible, sans parler.</p>
    </div>
  );
}

export function GhostScreen({ view }: { view: PlayerView }) {
  return (
    <div className="screen">
      <PlayerChip player={view.me} strike />
      <div className="panel hero grow">
        <Crewmate color={view.me.color} size={110} variant="ghost" />
        <div className="title">Tu es un fantôme</div>
        <p className="big" style={{ margin: 0 }}>
          Tu ne parles jamais aux vivants.
        </p>
        {view.me.ejected && <p className="muted">Tu as été éjecté.</p>}
      </div>
      <HoldToReveal hint="Maintenir pour voir ton rôle">
        <RoleCard view={view} />
      </HoldToReveal>
    </div>
  );
}

export function GameOverScreen({ view }: { view: PlayerView }) {
  if (!view.gameOver) return null;
  return (
    <div className="screen">
      <GameOverBlock info={view.gameOver} />
      <p className="muted center">Le maître du jeu peut relancer une partie.</p>
    </div>
  );
}
