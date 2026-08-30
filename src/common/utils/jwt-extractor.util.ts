import type { Request } from 'express';
import { JwtFromRequestFunction } from 'passport-jwt';

export function cookieExtractor(cookieName: string): JwtFromRequestFunction {
  return (req: Request): string | null => {
    if (!req?.cookies) return null;

    return (
      req.cookies[cookieName] ?? req.cookies[`__Host-${cookieName}`] ?? null
    );
  };
}

export function multiCookieExtractor(
  ...cookieNames: string[]
): JwtFromRequestFunction {
  return (req: Request): string | null => {
    if (!req?.cookies) return null;
    for (const name of cookieNames) {
      const value = req.cookies[name] ?? req.cookies[`__Host-${name}`];
      if (value) return value as string;
    }
    return null;
  };
}
