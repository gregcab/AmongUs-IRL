import type { TaskProgress } from "@among-us/shared";

/** Crew task bar, on phones, the TV and the admin console. */
export function TaskBar({ bar, large }: { bar: TaskProgress; large?: boolean }) {
  const ratio = bar.total === 0 ? 0 : bar.done / bar.total;
  return (
    <div className={`taskbar${large ? " large" : ""}`}>
      <div className="taskbar-label">
        <span>Tâches de l'équipage</span>
        <strong>{Math.round(ratio * 100)} %</strong>
      </div>
      <div className="taskbar-track">
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** The bar players and the TV see; the server withholds it while the radio is down. */
export function CrewTaskBar({ view, large }: { view: { taskBar?: TaskProgress; sabotage?: { kind: string }; params: { taskBarUpdates: string } }; large?: boolean }) {
  if (view.taskBar) return <TaskBar bar={view.taskBar} large={large} />;
  if (view.sabotage?.kind !== "comms" || view.params.taskBarUpdates === "never") return null;
  return (
    <div className={`taskbar scrambled${large ? " large" : ""}`}>
      <div className="taskbar-label">
        <span>Tâches de l'équipage</span>
        <strong>??? %</strong>
      </div>
      <div className="taskbar-track">
        <span />
      </div>
    </div>
  );
}
