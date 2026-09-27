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
