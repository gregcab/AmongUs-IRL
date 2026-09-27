import { ADMIN_COOKIE, SESSION_COOKIE } from "@among-us/shared";

const SESSION_KEY = "amongus.session";
const ADMIN_KEY = "amongus.admin";
const DEV_KEY = "amongus.dev";

/** `?dev=1` keeps sessions per tab so several players can share one browser. */
export function isDevMode(): boolean {
  try {
    if (new URLSearchParams(location.search).get("dev") === "1") sessionStorage.setItem(DEV_KEY, "1");
    return sessionStorage.getItem(DEV_KEY) === "1";
  } catch {
    return false;
  }
}

function store(): Storage | null {
  try {
    return isDevMode() ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function setCookie(name: string, value: string | null): void {
  const maxAge = value === null ? 0 : 60 * 60 * 24 * 7;
  document.cookie = `${name}=${encodeURIComponent(value ?? "")}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function getSession(): string | null {
  const fromStore = store()?.getItem(SESSION_KEY) ?? null;
  if (fromStore) return fromStore;
  return isDevMode() ? null : readCookie(SESSION_COOKIE);
}

export function setSession(token: string | null): void {
  const s = store();
  try {
    if (token === null) s?.removeItem(SESSION_KEY);
    else s?.setItem(SESSION_KEY, token);
  } catch {
    // Storage may be unavailable (private mode); the cookie still carries the session.
  }
  if (!isDevMode()) setCookie(SESSION_COOKIE, token);
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY) ?? readCookie(ADMIN_COOKIE);
  } catch {
    return readCookie(ADMIN_COOKIE);
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(ADMIN_KEY);
    else localStorage.setItem(ADMIN_KEY, token);
  } catch {
    // ignore
  }
  setCookie(ADMIN_COOKIE, token);
}
