import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getSafeNextPath, verifySessionToken } from '@/lib/auth';

function isPublicAsset(pathname: string) {
  return pathname.startsWith('/_next') || pathname === '/favicon.ico' || /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$/.test(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicAsset(pathname) || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const isSignedIn = await verifySessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  if (isSignedIn) {
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
  }

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (pathname === '/login') {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', getSafeNextPath(`${pathname}${search}`));

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)'],
};
