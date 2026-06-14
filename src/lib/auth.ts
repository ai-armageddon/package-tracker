export const AUTH_COOKIE_NAME = 'package_tracker_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'pass';

function getUsername() {
  return process.env.PACKAGE_TRACKER_USERNAME || DEFAULT_USERNAME;
}

function getPassword() {
  return process.env.PACKAGE_TRACKER_PASSWORD || DEFAULT_PASSWORD;
}

function getSessionSecret() {
  return process.env.PACKAGE_TRACKER_SESSION_SECRET || getPassword();
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export function verifyCredentials(username: string, password: string) {
  return username === getUsername() && password === getPassword();
}

export async function createSessionToken() {
  const payload = `${getUsername()}|${Date.now()}`;
  const encodedPayload = textToBase64Url(payload);
  const signature = await sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token?: string) {
  if (!token) return false;

  const [encodedPayload, signature, extra] = token.split('.');
  if (!encodedPayload || !signature || extra) return false;

  const expectedSignature = await sign(encodedPayload);
  if (!sameSignature(signature, expectedSignature)) return false;

  try {
    const payload = base64UrlToText(encodedPayload);
    const separator = payload.lastIndexOf('|');
    if (separator === -1) return false;

    const username = payload.slice(0, separator);
    const issuedAt = Number(payload.slice(separator + 1));
    const expiresAt = issuedAt + SESSION_MAX_AGE_SECONDS * 1000;

    return username === getUsername() && Number.isFinite(issuedAt) && Date.now() < expiresAt;
  } catch {
    return false;
  }
}

export function getSafeNextPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  return value;
}
