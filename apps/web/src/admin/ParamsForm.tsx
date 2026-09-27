import {
  PARAM_BOUNDS,
  SABOTAGE_KINDS,
  SABOTAGE_LABEL,
  TASK_BAR_LABEL,
  TASK_CATEGORY_LABEL,
  TASK_DEFS,
  TASK_TYPES,
  type GameParams,
  type TaskBarUpdates,
  type TaskCategory,
} from "@among-us/shared";
import { useEffect, useState } from "react";

const NUMERIC: { key: keyof typeof PARAM_BOUNDS; label: string }[] = [
  { key: "minPlayers", label: "Joueurs minimum" },
  { key: "roleRevealSeconds", label: "Révélation des rôles (s)" },
  { key: "deathDelaySeconds", label: "Délai avant mort effective (s)" },
  { key: "killCooldownSeconds", label: "Cooldown de kill (s)" },
  { key: "bodyQrRotationSeconds", label: "Rotation du QR du corps (s)" },
  { key: "emergencyMeetingsPerPlayer", label: "Réunions d'urgence par joueur" },
  { key: "emergencyCooldownSeconds", label: "Cooldown d'urgence (s)" },
  { key: "gatheringTimeoutSeconds", label: "Rassemblement max (s)" },
  { key: "discussionSeconds", label: "Discussion (s)" },
  { key: "votingSeconds", label: "Vote (s)" },
  { key: "resumeCountdownSeconds", label: "Dispersion avant reprise (s)" },
];

const TASK_COUNTS: { key: keyof typeof PARAM_BOUNDS; category: TaskCategory }[] = [
  { key: "commonTasks", category: "common" },
  { key: "longTasks", category: "long" },
  { key: "shortTasks", category: "short" },
];

const SABOTAGE_NUMERIC: { key: keyof typeof PARAM_BOUNDS; label: string }[] = [
  { key: "sabotageCriticalSeconds", label: "Compte à rebours critique (s)" },
  { key: "sabotageCooldownSeconds", label: "Délai entre deux sabotages (s)" },
];

export function ParamsForm({ params, onSave }: { params: GameParams; onSave: (p: Partial<GameParams>) => Promise<boolean> }) {
  const [draft, setDraft] = useState<GameParams>(params);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(params);
  }, [params, dirty]);

  const update = <K extends keyof GameParams>(key: K, value: GameParams[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  return (
    <form
      className="params-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(draft)) setDirty(false);
      }}
    >
      <div className="params-section">
        <h4>Partie</h4>
        <label>
          <span>Imposteurs</span>
          <select
            className="input"
            value={String(draft.impostorCount)}
            onChange={(e) => update("impostorCount", e.target.value === "auto" ? "auto" : Number(e.target.value))}
          >
            <option value="auto">Automatique</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {NUMERIC.map(({ key, label }) => (
          <NumberField key={key} field={key} label={label} value={draft[key]} onChange={(v) => update(key, v)} />
        ))}
        <label>
          <span>Fantômes pendant les réunions</span>
          <select className="input" value={draft.ghostMeetingMode} onChange={(e) => update("ghostMeetingMode", e.target.value as GameParams["ghostMeetingMode"])}>
            <option value="cemetery">Cimetière</option>
            <option value="spectator">Spectateurs</option>
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={draft.confirmEjects} onChange={(e) => update("confirmEjects", e.target.checked)} />
          <span>Révéler le rôle de l'éjecté</span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={draft.anonymousVotes} onChange={(e) => update("anonymousVotes", e.target.checked)} />
          <span>Votes anonymes</span>
        </label>
      </div>

      <div className="params-section">
        <h4>Tâches</h4>
        {TASK_COUNTS.map(({ key, category }) => (
          <NumberField key={key} field={key} label={`${TASK_CATEGORY_LABEL[category]} par joueur`} value={draft[key]} onChange={(v) => update(key, v)} />
        ))}
        <label>
          <span>Barre de progression</span>
          <select className="input" value={draft.taskBarUpdates} onChange={(e) => update("taskBarUpdates", e.target.value as TaskBarUpdates)}>
            {(Object.keys(TASK_BAR_LABEL) as TaskBarUpdates[]).map((mode) => (
              <option key={mode} value={mode}>
                {TASK_BAR_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={draft.freezeTasksDuringMeeting} onChange={(e) => update("freezeTasksDuringMeeting", e.target.checked)} />
          <span>Geler les tâches pendant les réunions</span>
        </label>
        {(["common", "long", "short"] as TaskCategory[]).map((category) => (
          <div key={category} className="task-toggles">
            <span className="muted small">{TASK_CATEGORY_LABEL[category]}</span>
            {TASK_DEFS.filter((d) => d.category === category).map((d) => (
              <label key={d.type} className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.enabledTasks.includes(d.type)}
                  onChange={(e) => update("enabledTasks", toggle(draft.enabledTasks, d.type, e.target.checked, TASK_TYPES))}
                />
                <span>
                  {d.name}
                  {"coop" in d && <span className="muted small"> · {d.coop} joueurs</span>}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="params-section">
        <h4>Sabotages</h4>
        {SABOTAGE_KINDS.map((kind) => (
          <label key={kind} className="checkbox">
            <input
              type="checkbox"
              checked={draft.enabledSabotages.includes(kind)}
              onChange={(e) => update("enabledSabotages", toggle(draft.enabledSabotages, kind, e.target.checked, SABOTAGE_KINDS))}
            />
            <span>{SABOTAGE_LABEL[kind]}</span>
          </label>
        ))}
        {SABOTAGE_NUMERIC.map(({ key, label }) => (
          <NumberField key={key} field={key} label={label} value={draft[key]} onChange={(v) => update(key, v)} />
        ))}
      </div>

      <div className="row params-actions">
        <button className="btn" disabled={!dirty}>
          Enregistrer
        </button>
        {dirty && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setDraft(params);
              setDirty(false);
            }}
          >
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

function NumberField({ field, label, value, onChange }: { field: keyof typeof PARAM_BOUNDS; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input className="input" type="number" min={PARAM_BOUNDS[field][0]} max={PARAM_BOUNDS[field][1]} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Adds or removes `item`, keeping the catalog order. */
function toggle<T extends string>(list: readonly T[], item: T, on: boolean, order: readonly T[]): T[] {
  return order.filter((x) => (x === item ? on : list.includes(x)));
}

