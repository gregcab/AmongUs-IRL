import { SESSION_HEADER } from "@among-us/shared";
import { useEffect, useState } from "react";
import { getSession } from "../lib/session";

export type ScanType = "report" | "emergency" | "practice";

type State = { kind: "sending" } | { kind: "ok" } | { kind: "error"; message: string } | { kind: "no-session" };

const ENDPOINT: Record<ScanType, string> = {
  report: "/api/report",
  emergency: "/api/emergency",
  practice: "/api/practice",
};

/** Posts a scanned body, emergency or practice token with the stored session. */
export async function sendScan(
  type: ScanType,
  token: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; code?: string; message: string }> {
  const session = getSession();
  if (!session) return { ok: false, code: "NOT_AUTHENTICATED", message: "Session introuvable" };
  try {
    const res = await fetch(ENDPOINT[type], {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: session },
      body: JSON.stringify({ token }),
      signal,
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { code: string; message: string } } | null;
    if (res.ok && body?.ok) return { ok: true };
    return { ok: false, code: body?.error?.code, message: body?.error?.message ?? "Erreur inconnue" };
  } catch {
    return { ok: false, message: "Serveur injoignable" };
  }
}

/** Landing page of a QR scan made with the phone's native camera. */
export function ScanPage({ type, token }: { type: ScanType; token: string }) {
  const [state, setState] = useState<State>({ kind: "sending" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void sendScan(type, token, controller.signal).then((res) => {
      if (controller.signal.aborted) return;
      if (res.ok) setState({ kind: "ok" });
      else if (res.code === "NOT_AUTHENTICATED") setState({ kind: "no-session" });
      else setState({ kind: "error", message: res.message });
    });
    return () => controller.abort();
  }, [type, token]);

  useEffect(() => {
    if (state.kind !== "ok") return;
    const t = setTimeout(() => location.replace("/"), type === "practice" ? 4000 : 2500);
    return () => clearTimeout(t);
  }, [state.kind, type]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
    } catch {
      // Clipboard needs a secure context on some browsers: select the text instead.
      const input = document.getElementById("scan-url") as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <div className="screen center">
      {state.kind === "sending" && <p className="big">Envoi…</p>}
      {state.kind === "ok" &&
        (type === "practice" ? (
          <>
            <div className="scan-ok-mark">✓</div>
            <div className="title">Scan OK</div>
            <p className="big">Ce navigateur a bien ta session : pendant la partie, tes scans fonctionneront.</p>
            <a className="btn" href="/">
              Retour au jeu
            </a>
          </>
        ) : (
          <>
            <div className="title">{type === "report" ? "Corps signalé !" : "Réunion d'urgence appelée !"}</div>
            <p className="big">Rendez-vous au point de rassemblement.</p>
            <a className="btn" href="/">
              Retour au jeu
            </a>
          </>
        ))}
      {state.kind === "error" && (
        <>
          <div className="title">Refusé</div>
          <p className="big">{state.message}</p>
          <a className="btn secondary" href="/">
            Retour au jeu
          </a>
        </>
      )}
      {state.kind === "no-session" && (
        <>
          <div className="big">Ouvrez ce lien dans le navigateur avec lequel vous avez rejoint la partie</div>
          {type === "report" && (
            <p className="muted">
              Plus simple : dans le jeu, touchez « Code d'un corps » et tapez les 4 chiffres affichés sous le QR du corps.
            </p>
          )}
          {type === "practice" && (
            <div className="panel stack" style={{ textAlign: "left" }}>
              <span className="eyebrow">Conseil</span>
              <p style={{ margin: 0 }}>
                L'appareil photo ouvre le <b>navigateur par défaut</b> du téléphone (Safari sur iPhone, souvent Chrome sur Android). Rejoignez la
                partie avec ce navigateur-là : demandez au maître du jeu de retirer votre inscription, puis scannez le grand QR code de la TV.
              </p>
              <p className="muted small" style={{ margin: 0 }}>
                Sinon, pendant la partie, signalez les corps en tapant leur code à 4 chiffres dans le jeu.
              </p>
            </div>
          )}
          <input id="scan-url" className="input" readOnly value={location.href} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={copy}>
            {copied ? "Lien copié" : "Copier le lien"}
          </button>
        </>
      )}
    </div>
  );
}
