// web-next/middleware.js
// Auth cookie (`auth_token`, httpOnly) ko `Authorization: Bearer` header me convert karta hai
// taaki Next rewrite ke through backend ko wahi JWT mile jo wo expect karta hai.
// Browser JS ko token kabhi nahi dikhta (cookie httpOnly hai).
// /api/auth/* route handlers ko skip karte hain (wo Next ke apne login/logout handlers hain).

import { NextResponse } from 'next/server';

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Next ke apne auth route handlers (login/logout) ko chhod do.
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  const token = request.cookies.get('auth_token')?.value;
  if (token) {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
