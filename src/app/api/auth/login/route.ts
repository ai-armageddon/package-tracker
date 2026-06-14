import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getSafeNextPath,
  verifyCredentials,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const username = formData.get('username');
  const password = formData.get('password');
  const nextPath = getSafeNextPath(formData.get('next'));

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !verifyCredentials(username, password)
  ) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', '1');
    loginUrl.searchParams.set('next', nextPath);

    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
  response.cookies.set(AUTH_COOKIE_NAME, await createSessionToken(), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
