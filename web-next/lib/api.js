// web-next/lib/api.js
// Centralized API client. Saare API calls /api/* se hote hain (Next proxy -> Express).
// Phase 1 me sirf public health check use hota hai. Aage ke phase me login ke baad
// JWT Authorization header yahin se attach kiya jayega (yahan koi naya auth nahi banaya).

const BASE = '/api';

export async function apiFetch(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };

  let body = options.body;
  if (body != null && typeof body !== 'string' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers, body, credentials: 'include' });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (data && (data.message || data.error)) ||
      `Request failed with status ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export default apiFetch;
