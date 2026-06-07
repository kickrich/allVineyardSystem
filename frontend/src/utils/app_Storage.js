import { LOGS_CLEARED_AT_KEY } from '../constants/app.js';

export function normalizeConfirmText(v, fallback) {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

export function readLogsClearedAtMs() {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(LOGS_CLEARED_AT_KEY);
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  } catch {
    return 0;
  }
}

export function writeLogsClearedAtMs(ms) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOGS_CLEARED_AT_KEY, String(Number(ms) || Date.now()));
  } catch {
  }
}

export function hasStoredApiToken() {
  if (typeof window === 'undefined') return false;
  const t = localStorage.getItem('api_token');
  return Boolean(t && t.trim().length > 0);
}

export function getStoredApiUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('api_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user && typeof user === 'object' ? user : null;
  } catch {
    return null;
  }
}
