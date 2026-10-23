// web-next/app/api/auth/superadmin/route.js  (server route handler)
// SuperAdmin management login ko existing backend POST /api/auth/superadmin/login
// se verify karta hai aur token ko httpOnly cookie me set karta hai.
// Token response body me kabhi nahi jata. Ye route bilkul app/api/auth/hr/route.js
// jaisa hai — same cookie, same middleware Bearer injection, koi naya auth nahi.

import { NextResponse } from 'next/server';

const BACKEND = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');

  if (!username || !password) {
    return NextResponse.json({ success: false, message: 'SuperAdmin username aur password required hain.' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}/api/auth/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success || !data?.token) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Invalid SuperAdmin credentials.' },
        { status: res.status || 401 },
      );
    }

    const response = NextResponse.json({ success: true, role: data.role || 'SUPERADMIN' });
    response.cookies.set('auth_token', data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8, // backend JWT expiry (8h)
    });
    return response;
  } catch {
    return NextResponse.json({ success: false, message: 'Backend se connect nahi ho paya. Thodi der baad try karein.' }, { status: 502 });
  }
}