import { PARAM_BOUNDS, type GameParams } from "@among-us/shared";
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
      className="stack params-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(draft)) setDirty(false);
      }}
    >
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
        <label key={key}>
          <span>{label}</span>
          <input
            className="input"
            type="number"
            min={PARAM_BOUNDS[key][0]}
            max={PARAM_BOUNDS[key][1]}
            value={draft[key]}
            onChange={(e) => update(key, Number(e.target.value))}
          />
        </label>
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
      <div className="row">
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
