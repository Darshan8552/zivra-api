# Search Design — Unified People + Tags + Posts (D)

> **Date:** 2026-08-28 | **Status:** draft | **Author:** Muse Spark | **Stack:** NestJS 11 + Prisma 7 + TanStack Start 1.168 | **Route:** `/_main/search/` | **Related:** `zivra-api/src/users/users.controller.ts:28`, `zivra-api/src/hashtags/hashtags.controller.ts:9`, `zivra-web/src/routes/_main/search/index.tsx:8`

## 1. Overview

Replace mock search page (`search/index.tsx:8` — dead input `47:51`, mock `discoverGrid`/`trendingTopics` `mock.ts:210`) with **unified search** covering **People** (user `username`/`name` via `GET /users/search` `search-users.dto.ts:11`), **Tags** (hashtag prefix via `GET /hashtags/suggestions` `hashtags.service.ts:16`), and **Posts/Moments** (caption + hashtag via **new** `GET /posts/search` and `GET /hashtags/:name/posts`). UX: single bar + 3 tabs `?q=&tab=people|tags|posts` (shareable URL, like `feed/index.tsx:17` `following|discovery`), debounced `300ms` live update (`use-debounced-value.ts:3` but 250ms→300ms for 3 parallel), typeahead preview `limit 5` + full paginated tab pages `limit 12-20` with `nextCursor` (`feed.service.ts:51` `take+1` pattern).

**Goal:** Deliver D with existing patterns, no new infra v1, indexes deferred unless p95 >200ms.

---

## 2. Requirements

### Functional

- **Unified bar:** One `<input data-testid="search-input">` (controlled, placeholder “Look for people, tags, moments…”) replaces `search/index.tsx:47` uncontrolled. Value synced to URL `validateSearch: z.object({q: z.string().max(50).optional(), tab: z.enum(["people","tags","posts"]).default("people")})` + `loaderDeps` for cache key.
- **Tabs:** `people` → user results (avatar, name, `isVerified`, follow button `useToggleFollow` `users.hooks.ts:57`); `tags` → `#{name} · {postCount} posts` (reuses `HashtagPicker.tsx:132` count); `posts` → `PostCard` (`src/components/PostCard.tsx:52`) grid. Default `people` when `q=""`, switchable with `role=tab` + `aria-selected`.
- **Typeahead preview:** When `q.trim().length >=1`, debounced parallel `searchUsers(q,5)` + `suggestHashtags(q,5)` + `searchPosts(q,12)` for active tab. Preview panels (5 items) above full list.
- **Full pagination:** Each tab is `useInfiniteQuery` with `queryKey ["search", tab, q, limit]` + `initialPageParam: undefined` + `getNextPageParam: lastPage.nextCursor ?? undefined` (canonical `feed/hooks.ts:7`). Limit: people `12`, tags `12`, posts `12`. Back-end uses `take+1`, `skip:1`, `nextCursor: last.id` (`users.service.ts:92` pattern).
- **Empty/loading/error/done:** Mirror `feed/index.tsx:142` — `isLoading → skeleton pulse` (`UserProfileView.tsx:214`), `isError → retry`, `items.length===0 → "No {tab} for 'q'" + clear button`, `hasNextPage → sentinel IntersectionObserver + Load more` (reuse `FollowList.tsx:29` pattern, `threshold 0.1`, `unobserve` fix), `!hasNextPage && items.length>0 → "You're all caught up"`.

### Non-Functional

- **Privacy:** Private/suspended users and private posts hidden. People search: only `status ACTIVE, deletedAt null` (`users.service.ts:54` already) — keep. Posts search: add `post.status ACTIVE, deletedAt null, user.status ACTIVE, deletedAt null` + for private author check `canViewPosts` `users.service.ts:458` (`follow.status ACCEPTED`). Fixes `audit-api.md:49` H6 (`GET /posts/:id` leak) and `feed.service.ts:45` gap.
- **Performance:** `limit 5` preview cached `staleTime 30s, gcTime 5m` (`posts.hooks.ts:48` already 30s for hashtags), posts tab `staleTime 30s` + `placeholderData: keepPreviousData` for tab switch (fixes `feed` H3 `audit-web.md:39`). No `pg_trgm` v1 — keep `ILIKE '%term%'` (`users.service.ts:390`) for 5-limit; add `CREATE EXTENSION pg_trgm` + `GIN on username/name/caption` in Phase 2 if p95 >200ms at 10k rows.
- **Validation:** DTO `q @MaxLength(50) @Transform(trim)` + web Zod `q: z.string().max(50).trim().optional()`. Fix `C4` `info assignment` later: cursor `@IsUUID('7')` for posts pagination (reuse `feed-query.dto.ts:5`).
- **Security:** `Throttler 30/min` for `GET /users/search` and `GET /posts/search` (enumeration gap `audit-api.md:30` C2) — deferred to post-MVP but DTO limits 5/12 bound abuse.

---

## 3. Architecture

```
zivra-web/src/routes/_main/search/index.tsx (Route validateSearch)
  ├── unified bar (controlled q, debounced 300ms, navigate({search}))
  ├── tabs people|tags|posts (FilterChip role=tab)
  │   ├── people: useSearchUsers(q) ──► searchUsersFn ──► GET /api/users/search?q=&limit=12
  │   ├── tags: useHashtagSuggestions(q) ──► suggestHashtagsFn ──► GET /api/hashtags/suggestions?q=&limit=12 + GET /api/hashtags/:name/posts
  │   └── posts: useSearchPosts(q) ──► searchPostsFn ──► GET /api/posts/search?q=&cursor=&limit=12
  └── trending fallback (q=""): hashtags/suggestions?q=&limit=5 + trending public posts fallback (like feed.service.ts:131)

zivra-api/src/...
  ├── users (existing): GET /users/search (reuse, bump Max 5→20 for full tab but keep service take 5 for preview limit param) — src/users/dto/search-users.dto.ts:11, src/users/users.service.ts:390
  ├── hashtags (existing): GET /hashtags/suggestions — src/hashtags/hashtags.service.ts:16
  └── posts (new): GET /posts/search + GET /hashtags/:name/posts
      ├── DTO SearchPostsDto (q, limit, cursor) mirrors SearchUsersDto
      ├── Service searchPosts(q, cursor, limit, viewerId): Prisma
      │   where: { status ACTIVE, deletedAt null, user {status ACTIVE, deletedAt null, (isPrivate ? canViewPosts : true) },
      │            OR: [{caption: {contains: term, mode: insensitive}}, {hashtags: {some: {hashtag: {name: contains term, mode: insensitive}}}}] }
      │   orderBy: createdAt desc, take+1, cursor skip1, include FEED_POST_INCLUDE
      └── Module PostsModule import

New shared: src/lib/search/ (web) — types SearchTab, hooks useSearchUsers/useHashtagSuggestions/useSearchPosts, functions searchPostsFn/getHashtagPostsFn. Move searchUsersFn from posts.function.ts:40 (misplaced lib/posts) to users.function.ts:22.
```

**Files touched (authoritative):**

- **API (4):** `zivra-api/src/posts/posts.controller.ts:26` add `GET search`, `zivra-api/src/posts/posts.service.ts:1` add `searchPosts`, `zivra-api/src/posts/dto/search-posts.dto.ts` new, `zivra-api/src/hashtags/hashtags.controller.ts:9` add `GET :name/posts` optional or keep under `posts`.
- **Web (7):** `zivra-web/src/routes/_main/search/index.tsx:8` rewrite, `zivra-web/src/lib/search/{search.hooks.ts,search.function.ts,search.types.ts}` new, `zivra-web/src/lib/users/users.hooks.ts:22` move search hook, `zivra-web/src/lib/posts/posts.hooks.ts:46` keep but import from search, `zivra-web/src/lib/use-debounced-value.ts:3` reuse.
- **Prisma:** no schema change v1 (uses existing `Post.caption`, `PostHashtag`, `Hashtag.name`). Optional `@@index([caption])` not needed for `contains insensitive` (text field).

---

## 4. Components — Detailed

### 4.1 API — `POSTS SEARCH`

**DTO:** `zivra-api/src/posts/dto/search-posts.dto.ts`
```ts
export class SearchPostsDto {
  @IsOptional() @IsString() @MaxLength(50) @Transform(({value})=> value?.trim()) q?: string;
  @IsOptional() @IsString() @IsUUID('7') cursor?: string;
  @IsOptional() @Transform(({value})=> parseInt(value,10)) @IsInt() @Min(1) @Max(50) limit?: number;
}
```

**Service:** `zivra-api/src/posts/posts.service.ts: add searchPosts(q, cursor, limit, viewerId)` — steps: (1) `term = q?.trim(); if(!term) return {items:[], nextCursor:null}` (same early return as `users.service.ts:391`), (2) `take = min(limit ?? 12, 50)`, (3) build `where` as above + `canViewPosts` loop for private authors (batch `viewer follows` like `feed.service.ts:38`), (4) `prisma.post.findMany({where, take: take+1, ...(cursor?{cursor:{id:cursor},skip:1}:{}), orderBy:{createdAt:'desc'}, include: FEED_POST_INCLUDE})`, (5) `hasMore = length > take`, slice, enrich `liked/bookmarked` via `feed.service.ts:175` batch.

**Alternative for tags tab:** `GET /hashtags/:name/posts` — `hashtagId` lookup then `findMany` on `postHashtag` → `posts`, same inclusion.

**Controller:** `zivra-api/src/posts/posts.controller.ts: add @Get('search') search(@Query() dto: SearchPostsDto, @CurrentUser() user: SafeUser)` — must be **above** `@Get(':id')` (`52:55`) or `search` captured as `:id` (same ordering pitfall as `users.controller.ts:28` vs `59`). Auth required (global guard).

### 4.2 Web — `SEARCH PAGE`

**Route:** `zivra-web/src/routes/_main/search/index.tsx: export const Route = createFileRoute('/_main/search/')({ validateSearch: z.object({q: z.string().max(50).optional(), tab: z.enum(["people","tags","posts"]).default("people")}), component: SearchPage })`

**State:** `const [qInput, setQInput] = useState(search.q ?? ""); const qDebounced = useDebouncedValue(qInput.trim(), 300); useEffect(() => navigate({search: (prev)=> ({...prev, q: qDebounced || undefined})}), [qDebounced])` — keeps URL shareable. Input `data-testid="search-input"` controlled `value={qInput}` `onChange={e=>setQInput(e.target.value)}`.

**Queries:** `const peopleQuery = useSearchUsers(qDebounced)` etc. Each hook uses `useInfiniteQuery: queryKey ["search","people",qDebounced,limit] enabled: qDebounced.length>0, staleTime 30_000` (like `posts.hooks.ts:48`). `const activeQuery = tab==="people"?peopleQuery: tab==="tags"?tagsQuery:postsQuery`.

**Sections:** header input → trending fallback (`!qDebounced`) → tabs (`FilterChip` `feed/index.tsx:333` but `role=tab` + `aria-selected`, `onClick` → `navigate({search:{tab}})`), → results list (`PostCard`/`UserCard`/`TagCard`), → sentinel `useRef` + `useEffect` IntersectionObserver (copy `FollowList.tsx:29` — `threshold 0.1`, `observer.unobserve(el)` before `disconnect`).

**Types:** `zivra-web/src/lib/search/search.types.ts: export type SearchTab = "people"|"tags"|"posts"; export interface SearchPostsPage {items: Post[], nextCursor: string|null}`.

**Migration:** Move `searchUsersFn` from `posts.function.ts:40` → `users.function.ts:22`; keep `suggestHashtagsFn` in `posts.function.ts:13` or move to `src/lib/search/` — new `search.function.ts` re-exports both for single import.

---

## 5. Data Flow & Error Handling

**Flow (people tab):** User types `av` → `qInput` → `qDebounced` (300ms) → `navigate search q=av` → `useSearchUsers` enabled → `searchUsersFn({q:av, limit:12})` → `backendRequest GET /users/search?q=av&limit=12` (envelope `TransformInterceptor` `common/interceptors/transform.interceptor.ts:16` → unwrapped `data` `backend-client.ts:77`) → `peopleQuery.data.pages.flatMap(p=>p.items)` → render. Same for tags/posts.

**Error:** Each query `isError` → `retry` button `void activeQuery.refetch()` (mirror `feed/index.tsx:148`). `BackendApiError` `status 401` → redirect `/signin` via `beforeLoad` `/_main/route.tsx:6` already; `429` → toast rate-limit.

**Empty:** `items.length===0 && !isLoading` → `"No {tab} for 'q'"` + `Clear` button `setQInput("")`. `q=""` → trending (`hashtags/suggestions?q=&limit=5` `hashtags.service.ts:16` with empty normalized → `orderBy posts._count desc`; discoverGrid → trending public posts `where user.isPrivate false` like `feed.service.ts:143`).

**Privacy:** No private leakage — filtered server-side; web does not re-filter but types `isPrivate` stripped (like `users.service.ts:60` `select`).

---

## 6. Testing

**Unit:** `zivra-api/src/posts/posts.service.spec.ts` new `searchPosts` (mock `prisma.post.findMany` + `prisma.follow` for private author `canViewPosts` true/false; suspended user `status SUSPENDED` → 0 items). `zivra-api/src/users/users.service.spec.ts` extend search `limit/take` edge (empty `q` → `[]`, `q max 50` ok). Web `src/lib/search/search.hooks.spec.tsx` mock `searchUsersFn` debounced.

**E2E:** `zivra-web/playwright.config.ts:4` `search` — type `av` → `data-testid search-input` → expect `post`/`people` results within `trending` fallback; URL `?q=av&tab=posts` shareable deep-link; privacy: private user `?q=privateUser` not visible when not followed.

**Coverage:** `jest --coverageThreshold` on `src/posts/posts.service.ts` `searchPosts` branch.

---

## 7. Rollout & Risks

- **Order:** API `posts/search` first (no UI break), then web `search/` rewrite. Keep `Max 5` for preview, `12` for full page — bump via `SearchPostsDto` default.
- **Perf:** `ILIKE '%term%'` seq scan expected <50ms at 10k rows with `limit 12`; add `pg_trgm` (`CREATE EXTENSION pg_trgm; CREATE INDEX ... gin_trgm_ops`) if `EXPLAIN ANALYZE` shows Seq Scan on `users.service.ts:390` or `posts caption`.
- **Index:** No new indexes v1; Phase 2 add `@@index([status,deletedAt])` partial if trending slow.
- **Cache:** `staleTime 30s` shared; later add `Throttler 30/min` for search GETs (gap `audit-api.md:30`).

---

## 8. Spec Self-Review (inline fixes)

- **Placeholder scan:** No TBD/TODO — all `limit`/`cursor`/`q` defaults explicit, `validateSearch` zod concrete.
- **Internal consistency:** `limit 5 preview` vs `12 full` both fit DTO `Min 1 Max 50`; `posts.controller.ts` `search` above `:id` prevents capture (documented ordering pitfall `users.controller.ts:28`).
- **Scope check:** Focused single feature (unified search) — no followers/following rebuild.
- **Ambiguity fix:** `tag` vs `hashtag` normalized: API `name` stripped `^#+` `hashtags.service.ts:12`, web `part.slice(1)` `RichText.tsx:15` consistent; `postCount` `HashtagSuggestion` `posts.types.ts:59` is number (not `"128K"` mock `mock.ts:226`).
