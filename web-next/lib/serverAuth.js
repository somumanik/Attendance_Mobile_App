// web-next/lib/serverAuth.js  (SERVER-ONLY — client bundle me kabhi import nahi hota)
// Backend origin + authenticated server-side fetch. Token httpOnly cookie se padha jata hai.
import { cookies } from 'next/headers';

export const BACKEND_ORIGIN = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export async function getAuthToken() {
  const store = await cookies();
  return store.get('auth_token')?.value || null;
}

export async function fetchBackend(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  const authToken = token ?? (await getAuthToken());
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BACKEND_ORIGIN}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

// Current user verify karta hai (GET /api/me). Token invalid/expired ho to null.
export async function getCurrentUser() {
  const token = await getAuthToken();
  if (!token) return null;
  const { ok, data } = await fetchBackend('/api/me', { token });
  if (!ok || !data?.role) return null;
  return data;
}
