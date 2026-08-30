const NS = {
  AUTH: 'auth',
  RATE_LIMIT: 'rl',
  OTP: 'otp',
  SESSION: 'session',
  CACHE: 'cache',
} as const;

export const RedisKeys = {
  auth: {
    blacklist: (jti: string) => `${NS.AUTH}:bl:${jti}`,
    loginLock: (identifier: string) => `${NS.AUTH}:lock:${identifier}`,
    loginFailCount: (identifier: string) => `${NS.AUTH}:fail:${identifier}`,
    passwordReset: (tokenHash: string) => `${NS.AUTH}:pwd-reset:${tokenHash}`,
  },
  otp: {
    resendCooldown: (email: string, purpose: string) =>
      `${NS.OTP}:cooldown:${purpose}:${email.toLowerCase().trim()}`,
    attemptCount: (email: string, purpose: string) =>
      `${NS.OTP}:attempts:${purpose}:${email.toLowerCase().trim()}`,
  },
  rateLimit: {
    byIp: (ip: string, route: string) => `${NS.RATE_LIMIT}:ip:${ip}:${route}`,
    byUser: (userId: string, route: string) =>
      `${NS.RATE_LIMIT}:user:${userId}:${route}`,
  },
  session: {
    userSessions: (userId: string) => `${NS.SESSION}:user:${userId}`,
    metadata: (sessionId: string) => `${NS.SESSION}:meta:${sessionId}`,
  },
  cache: {
    userProfile: (userId: string) => `${NS.CACHE}:profile:${userId}`,
    publicProfile: (username: string) =>
      `${NS.CACHE}:profile:public:${username.toLowerCase().trim()}`,
    feedFollowing: (
      userId: string,
      cursor: string | undefined,
      limit: number | undefined,
    ) =>
      `${NS.CACHE}:feed:following:${userId}:${cursor ?? 'first'}:${limit ?? 12}`,
    feedDiscovery: (
      userId: string,
      cursor: string | undefined,
      limit: number | undefined,
    ) =>
      `${NS.CACHE}:feed:discovery:${userId}:${cursor ?? 'first'}:${limit ?? 12}`,
    feedFollowingPattern: (userId: string) =>
      `${NS.CACHE}:feed:following:${userId}:*`,
    feedDiscoveryPattern: (userId: string) =>
      `${NS.CACHE}:feed:discovery:${userId}:*`,
    feedAllPattern: () => `${NS.CACHE}:feed:*`,
  },
} as const;

export type RedisKeyPattern = ReturnType<typeof RedisKeys.auth.blacklist>;
