function resolveApiBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const direct =
    import.meta.env.VITE_API_DIRECT === 'true' ||
    import.meta.env.VITE_API_DIRECT === '1';
  if (import.meta.env.DEV && !direct) {
    return '';
  }
  return raw;
}

const baseUrl = resolveApiBaseUrl();

const TOKEN_KEY = 'api_token';
const USER_KEY = 'api_user';

export function clearApiSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function getStoredToken() {
  if (typeof window === 'undefined') return null;
  const t = localStorage.getItem(TOKEN_KEY);
  if (!t) return null;
  const trimmed = t.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shouldAttachAuth(path) {
  try {
    const pathname = path.startsWith('http') ? new URL(path).pathname : path.split('?')[0];
    return !pathname.includes('/auth/login');
  } catch {
    return true;
  }
}

function buildUrl(path) {
  if (path.startsWith('http')) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function parseApiError(response) {
  try {
    const payload = await response.json();
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      return payload.errors.join(', ');
    }
    if (typeof payload?.message === 'string' && payload.message.length > 0) {
      return payload.message;
    }
  } catch {}
  return `API ${response.status}: ${response.statusText}`;
}

export function apiRequest(path, options = {}) {
  const url = buildUrl(path);
  const headers = { ...options.headers };
  const hasJsonBody = options.body != null && !(options.body instanceof FormData);
  if (hasJsonBody && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = shouldAttachAuth(url) ? getStoredToken() : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
  const hasCallerSignal = options.signal instanceof AbortSignal;

  let controller;
  if (!hasCallerSignal) controller = new AbortController();
  const signal = hasCallerSignal ? options.signal : controller?.signal;

  let timeoutId;
  if (!hasCallerSignal) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  const fetchOptions = { ...options, headers, signal };
  return fetch(url, fetchOptions).finally(() => {
    if (!hasCallerSignal && timeoutId) clearTimeout(timeoutId);
  }).catch((err) => {
    if (err?.name === 'AbortError') {
      throw new Error(`Превышен таймаут запроса к API (${timeoutMs} мс): ${url}`);
    }
    throw err;
  });
}

async function handleJsonResponse(res, path) {
  if (!res.ok) {
    const detail = await parseApiError(res);
    if (res.status === 401 && shouldAttachAuth(path)) {
      clearApiSession();
      throw new Error(`Требуется авторизация или сессия устарела. ${detail} Обновите страницу.`);
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function apiGet(path) {
  const res = await apiRequest(path);
  return handleJsonResponse(res, path);
}

/** GET бинарный ответ (видео и т.п.). Увеличенный таймаут по умолчанию. */
export async function apiGetBlob(path, { timeoutMs = 120_000 } = {}) {
  const res = await apiRequest(path, { method: 'GET', timeoutMs });
  if (!res.ok) {
    const detail = await parseApiError(res);
    if (res.status === 401 && shouldAttachAuth(path)) {
      clearApiSession();
      throw new Error(`Требуется авторизация или сессия устарела. ${detail} Обновите страницу.`);
    }
    throw new Error(detail);
  }
  return res.blob();
}

/** @param {object} [options] @param {number} [options.timeoutMs] — иначе см. apiRequest (по умолчанию 10 с). */
export async function apiPost(path, body, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined;
  const res = await apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return handleJsonResponse(res, path);
}

export async function apiPostForm(path, formData) {
  const res = await apiRequest(path, { method: 'POST', body: formData });
  return handleJsonResponse(res, path);
}

export async function apiPatchForm(path, formData) {
  const res = await apiRequest(path, { method: 'PATCH', body: formData });
  return handleJsonResponse(res, path);
}

export async function apiPatch(path, body) {
  const res = await apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) });
  return handleJsonResponse(res, path);
}

export async function apiDelete(path) {
  const res = await apiRequest(path, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await parseApiError(res);
    if (res.status === 401 && shouldAttachAuth(path)) {
      clearApiSession();
      throw new Error(`Требуется авторизация или сессия устарела. ${detail} Обновите страницу.`);
    }
    throw new Error(detail);
  }
}
