// web-next/app/api/auth/logout/route.js  (server route handler)
// auth_token httpOnly cookie ko clear karta hai (logout).

import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
