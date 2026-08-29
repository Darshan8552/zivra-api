import type { Response } from 'express';

/**
 * Production-grade cookie handling:
 * - In production uses `__Host-` prefix (requires `Secure`, `Path=/`, no Domain)
 * - `SameSite=Lax` (strict breaks top-level navigation; lax is standard for social apps)
 * - `Path=/` ensures clear works across routes
 * - `httpOnly` always true
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
) {
  const isProduction = process.env.NODE_ENV === 'production';
  const accessName = isProduction ? '__Host-access_token' : 'access_token';
  const refreshName = isProduction ? '__Host-refresh_token' : 'refresh_token';

  // __Host- cookies MUST be Secure + Path=/ + no Domain — enforced here
  res.cookie(accessName, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000,
  });

  res.cookie(refreshName, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Clear stale variants with both Secure true/false to catch pre-fix cookies
  for (const name of ['access_token', 'refresh_token']) {
    res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.clearCookie(name, { httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
  }
}

export function clearAuthCookies(res: Response) {
  const names = [
    '__Host-access_token',
    'access_token',
    '__Host-refresh_token',
    'refresh_token',
  ];
  // Delete each name with both Secure true/false to handle migration from plain Secure:false to __Host Secure:true
  for (const name of names) {
    res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.clearCookie(name, { httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
  }
}
