// web-next/app/api/auth/webbridge/route.js
// Token handoff for the mobile WebView: mobile ke paas already valid JWT hai
// (secure storage), lekin website httpOnly `auth_token` cookie expect karta hai.
// Ye route token ko httpOnly cookie me set karke /hr/reports par redirect karta
// hai. Token URL me sirf ek transient redirect par aata hai; uske baad sirf
// httpOnly cookie kaam karti hai. Real validity server-side /api/me se phir se
// check hoti hai, isliye forged token kisi kaam ka nahi.

import { NextResponse } from 'next/server';

// Mobile Master Reports reuse — ONE-TIME CODE handoff (never the raw JWT).
// The mobile app calls the backend to obtain a short-lived, single-use opaque code,
// then opens this route with `?code=<code>`. We exchange it for the real JWT
// server-to-server, set the website's httpOnly `auth_token` cookie and redirect to
// /hr/reports?embed=mobile. The website's own /api/me re-validates every request,
// so the exchanged token is only used to bootstrap the cookie.
const BACKEND = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export async function GET(request) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();

  if (!code) {
    return NextResponse.redirect(new URL('/login/hr', request.url));
  }

  let token = null;
  try {
    const res = await fetch(`${BACKEND}/api/auth/handoff/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.token) token = data.token;
  } catch {
    // Backend unreachable — treat as unauthenticated and fall back to the login
    // redirect. The code is then wasted (single-use), which is safe.
  }

  if (!token) {
    return NextResponse.redirect(new URL('/login/hr', request.url));
  }

  const resp = NextResponse.redirect(new URL('/hr/reports?embed=mobile', request.url));
  resp.cookies.set('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return resp;
}
