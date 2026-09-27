import {
  KEY_WINDOW_MS,
  SHIELD_CHARGE_MS,
  stationDef,
  taskDef,
  taskStations,
  type PlayerTask,
  type PlayerView,
  type Station,
  type StationId,
} from "@among-us/shared";
import { useState } from "react";
import { serverNow, useNow } from "../lib/clock";
import { StationName, stationById } from "../lib/stations";
import { TaskBar } from "../lib/taskbar";
import { HoldPad } from "../lib/ui";
import { Antenna, CardSwipe, DataTransfer, Distributor, FuelHold, SafeCode, Simon, Wires } from "./minigames";
import type { Send } from "./PlayerApp";
import type { OpenStation } from "./station";

/** Where the player must go next for this task. */
function nextStations(task: PlayerTask, stations: Station[]): Station[] {
  return taskStations(task.type, task.step).map((id) => stationById(stations, id));
}

/** The player's list: identical for crewmates and impostors (whose list is fake). */
export function TaskList({ view }: { view: PlayerView }) {
  const tasks = view.tasks ?? [];
  const left = tasks.filter((t) => !t.done).length;
  // During a sabotage the list folds, so the game buttons stay on screen.
  const [unfolded, setUnfolded] = useState(false);
  const folded = view.sabotage !== undefined && !unfolded;
  return (
    <div className="panel stack task-panel">
      {view.taskBar && <TaskBar bar={view.taskBar} />}
      <div className="row spread">
        <span className="eyebrow">Mes tâches</span>
        {view.sabotage ? (
          <button type="button" className="link-btn" onClick={() => setUnfolded(!unfolded)}>
            {left === 0 ? "Toutes faites" : `${left} à faire`} · {folded ? "voir" : "masquer"}
          </button>
        ) : (
          <span className="muted small">{left === 0 ? "Toutes faites" : `${left} à faire`}</span>
        )}
      </div>
      {!folded && (
        <ul className="task-list">
          {tasks.map((t) => {
            const def = taskDef(t.type);
            return (
              <li key={t.id} className={t.done ? "done" : ""}>
                <span className="task-check" aria-hidden>
                  {t.done ? "✓" : ""}
                </span>
                <span className="task-text">
                  <span className="task-name">
                    {def.name}
                    {def.steps.length > 1 && !t.done && <span className="muted"> · étape {t.step + 1}/{def.steps.length}</span>}
                  </span>
                  {!t.done && (
                    <span className="task-where">
                      {nextStations(t, view.stations).map((st, i) => (
                        <span key={st.id}>
                          {i > 0 && " + "}
                          <StationName station={st} />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A task station: the mini-game of the player's task here, or what to do instead. */
export function TaskStation({ view, station, send }: { view: PlayerView; station: OpenStation; send: Send }) {
  const type = stationDef(station.id).task!;
  const def = taskDef(type);
  const task = view.tasks?.find((t) => t.type === type);
  const [justDone, setJustDone] = useState<string | null>(null);

  const complete = async (t: PlayerTask) => {
    const ok = await send("task:complete", { at: station.at, taskId: t.id });
    if (ok) setJustDone(`${t.id}:${t.step}`);
  };

  if (def.coop) {
    return (
      <>
        <p className="muted" style={{ margin: 0 }}>
          {def.help}
        </p>
        {type === "doubleKey" ? (
          <DoubleKey view={view} station={station} send={send} task={task} />
        ) : (
          <Shield view={view} station={station} send={send} task={task} />
        )}
      </>
    );
  }

  if (!task) return <div className="panel center big station-idle">Aucune tâche pour toi ici.</div>;
  if (task.done) {
    return (
      <div className="panel stack center station-idle">
        <span className="scan-ok-mark">✓</span>
        <div className="big">{def.name} : terminé !</div>
      </div>
    );
  }
  const here = taskStations(type, task.step).includes(station.id);
  if (!here) {
    const stepDone = justDone === `${task.id}:${task.step - 1}`;
    return (
      <div className="panel stack center station-idle">
        {stepDone && <span className="scan-ok-mark">✓</span>}
        <div className="big">{stepDone ? `Étape ${task.step}/${def.steps.length} terminée` : "Pas ici pour l'instant"}</div>
        <p className="muted" style={{ margin: 0 }}>
          {stepDone ? "Étape suivante" : `${def.name} : commence par`} à la station{" "}
          {nextStations(task, view.stations).map((st) => (
            <StationName key={st.id} station={st} />
          ))}
          .
        </p>
      </div>
    );
  }
  const done = () => void complete(task);
  const key = `${task.id}:${task.step}`;
  return (
    <div className="stack">
      <div className="task-title">
        <strong>{def.name}</strong>
        {def.steps.length > 1 && (
          <span className="muted">
            {" "}
            · étape {task.step + 1}/{def.steps.length}
          </span>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {def.help}
      </p>
      {type === "wires" && <Wires key={key} onDone={done} />}
      {type === "safe" && <SafeCode key={key} onDone={done} />}
      {type === "distributor" && <Distributor key={key} onDone={done} />}
      {type === "simon" && <Simon key={key} onDone={done} />}
      {type === "data" && <DataTransfer key={key} upload={task.step === 1} onDone={done} />}
      {type === "fuel" && <FuelHold key={key} empty={task.step === 1} onDone={done} />}
      {type === "card" && <CardSwipe key={key} onDone={done} />}
      {type === "antenna" && <Antenna key={key} onDone={done} />}
    </div>
  );
}

function CoopTaskStatus({ task }: { task?: PlayerTask }) {
  if (!task) return <p className="muted small center">Tu n'as pas cette tâche : tu peux aider les autres.</p>;
  return task.done ? <div className="big check center">Tâche terminée ✓</div> : null;
}

function DoubleKey({ view, station, send, task }: { view: PlayerView; station: OpenStation; send: Send; task?: PlayerTask }) {
  const now = useNow(250);
  const [turnedAt, setTurnedAt] = useState<number | null>(null);
  const other: StationId = station.id === "key-a" ? "key-b" : "key-a";
  const coop = view.coop;
  const theirs = coop?.keyTurns[other];
  const matched = turnedAt !== null && coop?.keyMatchAt !== undefined && coop.keyMatchAt >= turnedAt - 2000;
  const waiting = !matched && turnedAt !== null && now - turnedAt <= KEY_WINDOW_MS;
  const expired = !matched && turnedAt !== null && !waiting;
  const otherRecent = theirs !== undefined && now - theirs <= KEY_WINDOW_MS;
  return (
    <div className="panel stack center">
      <button
        type="button"
        className={`key-button${waiting ? " turned" : ""}${matched ? " matched" : ""}`}
        onClick={async () => {
          setTurnedAt(serverNow());
          await send("task:keyTurn", { at: station.at });
        }}
      >
        <span aria-hidden>🔑</span>
        {matched ? "Clés tournées !" : "Tourner la clé"}
      </button>
      <p className={matched ? "big check" : otherRecent && !waiting ? "warn-text" : "muted"} style={{ margin: 0 }}>
        {matched
          ? "Les deux clés ont tourné ensemble ✓"
          : waiting
            ? `Clé tournée : l'autre clé doit tourner dans ${Math.max(0, Math.ceil((KEY_WINDOW_MS - (now - turnedAt!)) / 1000))} s.`
            : otherRecent
              ? "L'autre clé vient de tourner : vite, tourne la tienne !"
              : expired
                ? "Trop tard : recomptez ensemble, puis tournez."
                : "Mettez-vous d'accord à voix haute avec la station"}{" "}
        {!matched && !waiting && !otherRecent && <StationName station={stationById(view.stations, other)} />}
      </p>
      <CoopTaskStatus task={task} />
    </div>
  );
}

function Shield({ view, station, send, task }: { view: PlayerView; station: OpenStation; send: Send; task?: PlayerTask }) {
  const now = useNow(200);
  const coop = view.coop;
  const needed = taskDef("shield").coop ?? 3;
  const holders = coop?.shieldHolders ?? 0;
  const started = coop?.shieldChargeStartedAt;
  const progress = started === undefined ? 0 : Math.min(1, (now - started) / SHIELD_CHARGE_MS);
  const charged = coop?.shieldDoneAt !== undefined && now - coop.shieldDoneAt < 8000;
  return (
    <div className="panel stack center">
      <HoldPad className="shield-pad" onHold={(holding) => void send("station:hold", { at: station.at, holding })}>
        {(holding) => (
          <>
            <span className="hand" aria-hidden>
              🛡️
            </span>
            <span>{holding ? "Garde le doigt posé…" : "Pose ton doigt ici et garde-le"}</span>
          </>
        )}
      </HoldPad>
      <div className="shield-count">
        Joueurs : <strong>{Math.min(holders, needed)} / {needed}</strong>
      </div>
      <div className="taskbar-track">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <p className={charged ? "big check" : "muted"} style={{ margin: 0 }}>
        {charged ? "Bouclier chargé ✓" : started !== undefined ? `Chargement : ${Math.ceil(((1 - progress) * SHIELD_CHARGE_MS) / 1000)} s` : `Il faut ${needed} joueurs en même temps.`}
      </p>
      <CoopTaskStatus task={task} />
    </div>
  );
}
