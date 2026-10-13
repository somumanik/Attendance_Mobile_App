// web-next/app/api/auth/employee/route.js  (server route handler)
// Employee login ko existing backend POST /api/auth/employee/login se verify karta hai
// (password ya 4-digit PIN) aur token httpOnly cookie me set karta hai.
// mustChangePassword / pinSetupRequired / firstTimeSetupRequired flags ko aage forward karta hai.

import { NextResponse } from 'next/server';

const BACKEND = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const paycode = String(body?.paycode || '').trim();
  const password = String(body?.password || '');
  const pin = String(body?.pin || '');
  const credential = String(body?.credential || '').trim().toLowerCase();
  const usePin = credential === 'pin' || (!password && !!pin);

  if (!paycode || (usePin ? !pin : !password)) {
    return NextResponse.json(
      { success: false, message: usePin ? 'Employee PIN required hai.' : 'Employee paycode aur password required hain.' },
      { status: 400 },
    );
  }

  const payload = usePin ? { paycode, pin, credential: 'pin' } : { paycode, password };

  try {
    const res = await fetch(`${BACKEND}/api/auth/employee/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success || !data?.token) {
      return NextResponse.json(
        {
          success: false,
          message: data?.message || 'Invalid employee credentials.',
          code: data?.code || null,
          firstTimeSetupRequired: data?.firstTimeSetupRequired === true,
        },
        { status: res.status || 401 },
      );
    }

    const response = NextResponse.json({
      success: true,
      role: data.role || 'EMPLOYEE',
      employee: data.employee || null,
      mustChangePassword: data.mustChangePassword === true,
      pinSetupRequired: data.pinSetupRequired === true,
    });
    response.cookies.set('auth_token', data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch {
    return NextResponse.json({ success: false, message: 'Backend se connect nahi ho paya. Thodi der baad try karein.' }, { status: 502 });
  }
}
