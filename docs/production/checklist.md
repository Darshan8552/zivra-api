# Checklist — Production To-Do

> **Source:** `audit-api.md`, `audit-web.md`, `audit-infra.md`, `roadmap.md`, `feed-hardening.md`  
> **Date:** 2026-08-28 | **Mode:** checkbox + owner + verification | **Stack:** NestJS 11 + Prisma 7 + TanStack Start 1.168

## How to Use

- [ ] = todo, [x] = done, `Verify:` = command to run.
- Priorities: **C** Critical (block deploy), **H** High, **M** Medium, **L** Low.

## Critical (Block Release)

- [ ] **C-01 Secrets** — Rotate `DATABASE_URL`, `JWT_*_SECRET` (`≥32 chars`), `BREVO_API_KEY`, `CLOUDINARY_API_SECRET`, `UPSTASH_REDIS_URL`; add `JWT_RESET_SECRET`; commit `.env.example` only — Files: `zivra-api/.env:1-20`, `zivra-api/src/services/tokens.service.ts:93` | **Verify:** vault shows new, `grep -r "xkeysib" zivra-api/.env` empty
- [x] **C-02 Env validation** — ~~Add Zod `validate` in `zivra-api/src/app.module.ts:22` and `zivra-web/src/lib/config/config.ts:1`~~ **DONE 2026-08-28** — Joi schema `zivra-api/src/config/env.validation.ts:1` + `ConfigModule.forRoot({validationSchema, allowUnknown:true})` (`zivra-api/src/app.module.ts:22`), `JWT_RESET_SECRET` added (`zivra-api/.env:9`), `.env.example` created | **Verify:** `npm run build` fails if `DATABASE_URL` missing — `npx tsc --noEmit` ✓, `schema.validate` ✓
- [x] **C-03 CORS fail-closed** — **DONE 2026-08-29** `origin: process.env.CORS_ORIGIN ? split+trim+filter : []` (`zivra-api/src/main.ts:15`, `zivra-api/src/notifications/notifications.gateway.ts:17`) — never `?? true` (`*` with `credentials:true`)
- [ ] **C-04 Cookies __Host-** — Fix `NODE_ENV === "production"` lowercase `zivra-web/src/lib/config/config.ts:7`; add `__Host-` only when `Secure`+`Path=/`+no `Domain`; `SameSite=lax` sync — `zivra-api/src/common/utils/cookies.util.ts:10`, `zivra-web/src/lib/config/session.server.ts:34` | **Verify:** Set-Cookie header has `__Host-access_token; Secure; Path=/; SameSite=Lax`
- [x] **C-05 Helmet + Throttler + CSRF** — **DONE 2026-08-29** `npm i helmet hpp @nestjs/throttler` (in-memory, resume project, no redis) — `helmet({hsts, csp, frameguard})` + `hpp` + `trust proxy` (`zivra-api/src/main.ts:1,14`), `ThrottlerModule.forRoot([{default:60},{search:30},{auth:10}])` + `APP_GUARD ThrottlerGuard` (`zivra-api/src/app.module.ts:22,48`), per-route `@Throttle` auth `10` (`zivra-api/src/auth/auth.controller.ts:32`), search `30` (`zivra-api/src/users/users.controller.ts:29`, `zivra-api/src/posts/posts.controller.ts:54`), feed `60` (`zivra-api/src/feed/feed.controller.ts:11`) | **Verify:** 12th `POST /auth/signin` 429; `curl -I` has `Strict-Transport-Security`
- [x] **C-06 Feed privacy** — **DONE 2026-08-29** `user:{status:'ACTIVE',deletedAt:null}` added to `getFollowingFeed` `zivra-api/src/feed/feed.service.ts:45` (was leak suspended/deleted), `feed.service.spec.ts:60` updated + new `suspended user not returned` test
- [x] **C-07 Exception + cursor validation** — **DONE 2026-08-29** `zivra-api/src/feed/dto/feed-query.dto.ts:5`, `zivra-api/src/users/dto/paginate-posts.dto.ts:5`, `zivra-api/src/comments/dto/paginate-comments.dto.ts:5`, `zivra-api/src/notifications/dto/paginate-notifications.dto.ts:5` `@IsUUID('7')` (was `@IsString` only) + `zivra-api/src/common/filters/http-exception.filter.ts:1` + `prisma-exception.filter.ts:1` (`P2025→400 Invalid cursor`) + `APP_FILTER` `zivra-api/src/app.module.ts:53`, `ValidationPipe` `validationError:{target:false,value:false}` `zivra-api/src/main.ts:41` | **Verify:** `GET /api/v1/feed/following?cursor=bad` 400
- [x] **C-08 Health** — **DONE 2026-08-29** `TerminusModule` + `HealthController` `@Controller({path:'health', version: VERSION_NEUTRAL})` `@Public() @SkipThrottle()` `zivra-api/src/health/health.controller.ts:7`, `RedisHealthIndicator` `zivra-api/src/health/redis.health.ts:1` via `RedisService.ping()` `zivra-api/src/redis/redis.service.ts:41`, `HealthModule` `zivra-api/src/app.module.ts:27`, `TransformInterceptor` bypass `/health` `zivra-api/src/common/interceptors/transform.interceptor.ts:27` — both `/api/health` + `/api/v1/health` `200 {status:'ok', info:{database,redis}}`
- [x] **C-09 Shutdown** — **DONE 2026-08-29** `app.enableShutdownHooks()` `zivra-api/src/main.ts:49` (enables `prisma.service.ts:21` `$disconnect` + `redis.service.ts:104` `quit` on `SIGTERM`)
- [x] **C-10 Web error boundaries** — **DONE 2026-08-29** `zivra-web/src/router.tsx:14` `defaultErrorComponent`/`defaultNotFoundComponent` + `DefaultError`/`DefaultNotFound` (Retry/Home), `zivra-web/src/routes/__root.tsx:21` `errorComponent`/`notFoundComponent`, `zivra-web/src/routes/_main/route.tsx:5` `errorComponent` (auth) — no white-screen
- [x] **C-11 Devtools guard** — **DONE 2026-08-29** `zivra-web/vite.config.ts:14` `devtools({removeDevtoolsOnBuild:true})`, `zivra-web/src/routes/__root.tsx:62` `{import.meta.env.DEV && <TanStackDevtools>}`, `zivra-web/src/integrations/tanstack-query/devtools.tsx:1` conditional `import.meta.env.DEV ? panel : null`, `zivra-web/package.json:19` move `@tanstack/*-devtools` `dependencies→devDependencies` | **Verify:** `dist` no strings
- [ ] **C-12 Feed validator Zod** — `z.object({cursor:z.string().uuid().optional(), limit:z.coerce.number().min(1).max(50).default(12)})` — `zivra-web/src/lib/feed/feed.function.ts:13` | **Verify:** `limit:999999` rejected client
- [ ] **C-13 401 handling** — `retry:false` + redirect to `/signin` on 401 feed — `zivra-web/src/lib/feed/feed.function.ts:6` | **Verify:** expired session redirects not loops
- [x] **C-14 Logout revoke** — **DONE 2026-08-29** `zivra-api/src/auth/auth.service.ts:372` dual extract (`cookieExtractor` `__Host-` + Bearer) + `blacklistToken` `auth:bl:jti` + `prisma.session.update revokedAt` via `refreshToken` verify, `zivra-api/src/auth/auth.controller.ts:132` `@Public() @Throttle auth 10` (was `@CurrentUser`), `zivra-api/src/notifications/notifications.gateway.ts:49` `RedisKeys.auth.blacklist` + cookie parse `__Host-access_token`, `zivra-web/src/lib/auth/auth.function.ts:93` `backendRequest /auth/logout` before `clearAuthCookies`, `zivra-web/src/lib/config/session.server.ts:41` dual `__Host-` delete + dual read `getValidAccessToken` | **Verify:** post-logout `GET /auth/me` + `POST /auth/refresh` + WS `401`
- [ ] **C-15 TLS + TTL** — Fix `redis.service.ts:17` ternary + align `JWT_*_EXPIRES_IN` 7d vs 30d — `zivra-api/src/services/tokens.service.ts:51`, `src/common/utils/cookies.util.ts:21` | **Verify:** `rediss://` connects with TLS; `exp` == cookie `maxAge`

## High

- [ ] **H-01 Unbounded IN** — Batch 500 / EXISTS — `zivra-api/src/feed/feed.service.ts:38,81,133` — **Verify:** `EXPLAIN` uses index, 100k follows not OOM
- [ ] **H-02 Feed cache** — Redis `feed:{userId}:{cursor}:{limit}` 30s + `Cache-Control` + invalidation — `zivra-api/src/feed/feed.service.ts:1` — **Verify:** 2nd `GET` `X-Cache: HIT`, k6 P95 <200ms
- [ ] **H-03 Discovery cursor merge** — Fix backfill + `nextCursor` — `zivra-api/src/feed/feed.service.ts:131,168` — **Verify:** page2 not empty/gap
- [ ] **H-04 Keyset pagination** — `(createdAt,id) < (cursorCreatedAt,cursorId)` — `zivra-api/src/feed/feed.service.ts:52` — **Verify:** concurrent insert no duplicate
- [ ] **H-05 Composite indexes** — `@@index([userId,status,deletedAt,createdAt])` partial — `prisma/schema.prisma:223` — new migration — **Verify:** `EXPLAIN ANALYZE` uses index
- [ ] **H-06 `GET /posts/:id` privacy** — Add `canViewPosts` — `zivra-api/src/posts/posts.service.ts:154` — **Verify:** private post 403
- [ ] **H-07 Web observer** — Fix sentinel `threshold/unobserve/IntersectionObserver` check — `zivra-web/src/routes/_main/feed/index.tsx:38` (reuse `FollowList.tsx:29`) — **Verify:** tab switch no wrong fetch
- [ ] **H-08 Web cache** — `staleTime 30s, gcTime 5m, keepPreviousData` — `zivra-web/src/lib/feed/feed.hooks.ts:8` — **Verify:** tab switch no spinner flicker
- [ ] **H-09 Invalidation** — `["users","suggestions"]` + `["feed"]` — `zivra-web/src/lib/users/users.hooks.ts:57`, `src/lib/likes/likes.hooks.ts:19` — **Verify:** follow/like reflects in feed without refresh
- [ ] **H-10 A11y** — `role=tab aria-selected` + stories aria + alt fallback — `zivra-web/src/routes/_main/feed/index.tsx:333`, `src/components/Stories.tsx:13`, `src/components/PostCard.tsx:193` — **Verify:** Lighthouse a11y 95+
- [ ] **H-11 Image SEO** — `srcset/sizes width/height decoding async poster` + `head() og: canonical` — `zivra-web/src/components/PostCard.tsx:193`, `src/routes/__root.tsx:22` — **Verify:** Lighthouse perf + SEO
- [ ] **H-12 `noImplicitAny` strict** — `tsconfig.json:22` — **Verify:** `npx tsc --noEmit` 0
- [ ] **H-13 CI gap** — No `.github/workflows` — **Verify:** CI runs `lint typecheck`

## Medium

- [ ] Structured logs `nestjs-pino` + `requestId` — `zivra-api/src/common/middlewares/global-logger.middleware.ts:8`
- [x] `.env.example` — **DONE** `zivra-api/.env.example:1` (covers all vars incl. `JWT_RESET_SECRET`); READMEs env table + `husky` + `lint-staged` — still todo
- [ ] Sparse tests: add `auth/users/posts` specs, `prisma/seed.ts` — `zivra-api/src/feed/feed.service.spec.ts:1` only
- [ ] `postId` vs `status` audit: fix `allowComments/likes` uniform — `zivra-api/src/likes/likes.service.ts:51`
- [ ] Remove `memoryStorage` 500MB risk → streaming — `zivra-api/src/posts/posts.controller.ts:33`
- [ ] Remove plaintext `localStorage zivra.signin.credentials` — `zivra-web/src/routes/_auth/signin/index.tsx:18`
- [x] Fix `Content-Type` on GET — **DONE** `zivra-web/src/lib/config/backend-client.ts:44` conditional header
- [ ] Dedup notifications — `zivra-api/src/posts/posts.service.ts:130`
- [ ] Triple `timeAgo` → single `src/lib/utils.ts:18`

## Low

- [x] `updare-profile.dto.ts` rename — **DONE 2026-08-28** `zivra-api/src/users/dto/update-profile.dto.ts` + imports `src/users/users.controller.ts:20`, `src/users/users.service.ts:20`
- [x] Duplicate `PATCH me/follow` vs `PATCH :username/follow` — **DONE 2026-08-29** deleted `PATCH :username/follow/accept|decline` `zivra-api/src/users/users.controller.ts:75` (dead code, `username` ignored, client only uses `me` `zivra-web/src/lib/notifications/notifications.function.ts:62`), keep `PATCH me/follow/*` with DTO `zivra-api/src/users/dto/respond-follow.dto.ts:1` `actorId IsUUID('7')`
- [x] `v1` prefix — **DONE 2026-08-29** `zivra-api/src/main.ts:9` `enableVersioning({type: VersioningType.URI, defaultVersion: '1'})` (`api` → dual ` /api` + `/api/v1`), `zivra-api/src/config/env.validation.ts:98` `API_VERSION` Joi, `zivra-api/.env.example:31` `API_VERSION=1`, `zivra-web/.env.example:1` `BACKEND_URL /api/v1`
- [x] Branding `pulse` → `zivra` — **DONE** `zivra-web/src/components/Sidebar.tsx:84` `zivra.`, `zivra-web/src/routes/_main/feed/index.tsx:92` dynamic date + `325` footer `Zivra`, `zivra-web/src/routes/__root.tsx:32` title `Zivra — Social` + description/theme-color
- [x] `GlobalLoggerMiddleware` emoji `console.log` → `Logger` — **DONE** `zivra-api/src/common/middlewares/global-logger.middleware.ts:8` level-aware `Logger`
- [x] `RedisService` TLS inverted — **DONE** `zivra-api/src/redis/redis.service.ts:17` `rediss:// ? {} : undefined`
- [x] `@nestjs/mapped-types:*` → `^2.1.0` — **DONE** `zivra-api/package.json:29`
- [x] `tsconfig` strict tightening — **DONE** `zivra-api/tsconfig.json:19` `strict:true`, `noImplicitAny:true`, `strictBindCallApply:true`, `strictPropertyInitialization:false` (keeps DTO `ValidationPipe` compat) + `zivra-api/src/mail/mail.service.ts:73` `e unknown` fix
- [x] `backend-client` `Content-Type` on GET — **DONE** `zivra-web/src/lib/config/backend-client.ts:44` only when `body !== undefined` (no preflight)
- [x] `__Host-` typo `Production` → `production` — **DONE** `zivra-web/src/lib/config/config.ts:8`
- [x] `Sidebar` `useSuspenseQuery` without `Suspense` → `useQuery` — **DONE** `zivra-web/src/components/Sidebar.tsx:15,61`; `BottomNav` `aria-label` — `src/components/Sidebar.tsx:158`
- [x] `PostCard` optimistic rollback — **DONE** `zivra-web/src/components/PostCard.tsx:76,83` revert on `onError`
- [x] `.vscode/settings.json` over-hide — **DONE** `zivra/.vscode/settings.json:2` now only hides `node_modules/.output/.tanstack/dist/.git`
- [x] `prettier` vs `biome` — documented: API `prettier` + web `biome` intentional split; no action

## Verification Commands

```bash
# API
npx tsc --noEmit
npm run build
npm run lint
npm test -- src/feed/feed.service.spec.ts
npx prisma migrate status

# Web
npx tsc --noEmit
npm run build
npx biome check src/lib/feed src/routes/_main/feed
npx playwright test

# Manual
curl -i http://localhost:3001/api/health
curl -H "Origin: https://evil.com" -i http://localhost:3001/api/feed/following
curl -i http://localhost:3001/api/feed/following?cursor=bad # expect 400
```

## Docs Map

- `audit-api.md` — API findings
- `audit-web.md` — Web findings
- `audit-infra.md` — Infra findings
- `roadmap.md` — Phased plan
- `feed-hardening.md` — Feed dedicated
- `checklist.md` — This file
