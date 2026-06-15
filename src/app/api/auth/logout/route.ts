import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getPublicUrl } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const base = getPublicUrl(request);
  const response = NextResponse.redirect(new URL('/login', base), { status: 303 });
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
