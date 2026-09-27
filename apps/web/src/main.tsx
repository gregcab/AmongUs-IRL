import { createRoot } from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";
import { PlayerApp } from "./player/PlayerApp";
import { ScanPage } from "./player/ScanPage";
import { TvApp } from "./tv/TvApp";
import "./styles.css";

function route() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const scan = /^\/(r|e)\/([^/]+)$/.exec(path);
  if (scan) return <ScanPage type={scan[1] === "r" ? "report" : "emergency"} token={decodeURIComponent(scan[2]!)} />;
  if (path === "/tv") return <TvApp />;
  if (path === "/admin") return <AdminApp />;
  return <PlayerApp />;
}

// No StrictMode: its double effects would send QR scans twice in development.
createRoot(document.getElementById("root")!).render(route());
