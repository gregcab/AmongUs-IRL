import { createRoot } from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";
import { PlayerApp } from "./player/PlayerApp";
import { ScanPage, type ScanType } from "./player/ScanPage";
import { TvApp } from "./tv/TvApp";
import "./styles.css";

const SCAN_TYPES: Record<string, ScanType> = { r: "report", e: "emergency", t: "practice" };

function route() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const scan = /^\/(r|e|t)\/([^/]+)$/.exec(path);
  if (scan) return <ScanPage type={SCAN_TYPES[scan[1]!]!} token={decodeURIComponent(scan[2]!)} />;
  if (path.startsWith("/s/")) {
    return (
      <div className="screen center">
        <div className="big">Les tâches arrivent bientôt.</div>
        <a className="btn secondary" href="/">
          Retour au jeu
        </a>
      </div>
    );
  }
  if (path === "/tv") return <TvApp />;
  if (path === "/admin") return <AdminApp />;
  return <PlayerApp />;
}

// No StrictMode: its double effects would send QR scans twice in development.
createRoot(document.getElementById("root")!).render(route());
