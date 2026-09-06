# mail — Design Decisions & Session Notes

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

## Standing design decisions & constraints

- **Vulnerability/review threat model: externally-exploitable only.** This library is a power
  tool for developers building their own services, not a hardened black box. When reviewing for
  "vulnerabilities," only count issues reachable from a downstream, untrusted HTTP/WebSocket
  client hitting a service built on the framework (anonymous or low-privilege caller). Do NOT
  flag: developer-only footguns (misusing an API, a decorator applied wrong in your own code),
  internal utilities only the operator touches (build/CLI/startup wiring), or purely theoretical
  races with no concrete external trigger path. Every finding should be able to name the actual
  HTTP route/method or WS message type that reaches the code in question.

- **Commit discipline.** Don't `git commit` unless explicitly asked, even after a full
  review-and-fix cycle with passing tests. Leave changes staged/unstaged and say so.
- **Commit message style: concise, one line per task/bug/feature — no verbose prose.** A commit
  message is a short list of one-line bullets, one per item. Never a paragraph explaining what was
  done or why for any single item — that belongs in the diff/code comments/NOTES.md, not the commit
  message. This mirrors JP's standing convention across his other repos.

## Session Log

### 2026-09-05 — Shared mailbox support (`Mailbox.ownerUserUid` optional, ACL-driven `find`/`count`)

Driven by `mail-server`'s implementation plan (exposing this library's REST surface via a webmail client +
admin console). Requirement: support Exchange-style shared mailboxes — a delegate with no ownership stake
seeing a shared mailbox in their own "list my mailboxes" call, and a true ownerless mailbox (e.g.
`support@example.com`) with no single owner at all, access governed purely by ACL grants.

- **Principle enforced throughout:** one route class serves self-service, delegate-shared, and trusted/admin
  callers alike, gated entirely by the ACL system (`ACLUtils`/`AccessControlList`/the existing generic
  `BaseACLRoute` from `@rapidrest/service-core`) — never a parallel admin-only route, and never new bespoke
  permission machinery where an existing mechanism already does the job. `BaseACLRoute` (mount it as
  `@Route("/acls")` per its own doc-comment example) is *the* mechanism for granting/revoking a delegate's
  share access — no new sharing endpoint was added anywhere.
- **The only real bug found:** `BaseMailboxRoute.find()`/`count()` hard-coded `ownerUserUid: user.uid`
  instead of asking the ACL system who can access what. Every other route in this library
  (`BaseFolderRoute`, everything built on `BaseScopedChildRoute`) already gates on
  `aclUtils.hasPermission(user, mailboxUid/folderUid, action)`, which already correctly resolves ownership,
  delegate shares (any `ACLRecord` on the target's `AccessControlList`), and the trusted-role global bypass —
  those needed *zero* changes. Only `Mailbox` itself needed fixing, because it has no parent scope to check
  permission against; its own class-level ACL denies everyone by design (see `BaseMailboxRoute`'s doc
  comment), so `find`/`count` must resolve "which mailbox uids can this caller see" themselves.
- **Fix mechanism:** `BaseMailboxRoute` now declares `protected abstract findAccessibleMailboxUids(user)`,
  implemented per-backend in `MailboxRouteMongo`/`MailboxRouteSQL` by querying the *same*
  `AccessControlListMongo`/`SQL` model `BaseACLRoute` exposes — no new `service-core` API was added.
  - Mongo: a native `{ "records.userOrRoleId": { $in: candidates } }` query (records is a real embedded
    array, natively queryable).
  - SQL: `AccessControlListSQL.records` is a `simple-json` column (a single serialized JSON string, not a
    joined table), so it's matched via `Raw()` + `LIKE '%"userOrRoleId":"<id>"%' ESCAPE '\'`, anchored on the
    specific JSON key (not just any quoted occurrence, to avoid a false-positive match against a
    coincidentally-identical string in a record's `actions` array) and escaped against `%`/`_` — mirrors the
    exact same problem/solution already established in `MailIngestRouteSQL.aliasQueryValue()` for
    `MailboxSQL.aliasAddresses` (also `simple-json`). **Known limitation:** this is a `LIKE` scan of the
    *entire* ACL table (every mailbox/folder/message/etc.'s ACL lives in one table) — no standard index can
    help a substring-in-JSON match. Acceptable for now; revisit with a dedicated reverse-lookup table if this
    becomes a real bottleneck at scale.
  - **Security-critical gotcha found while implementing this:** an *empty* accessible-uid list must
    short-circuit in the route (`return []` / `content-length: 0`) rather than being passed through as a
    `uid: []` query filter. `ModelUtils.buildSearchQuerySQL`/`Mongo`'s array-value "zip" logic resolves a
    key's filter value from `values[i]` or falls back to `values[values.length - 1]` for any query branch past
    the array's own length — for an empty array, `values.length - 1 === -1`, so `values[-1]` is `undefined`,
    and TypeORM (and this query builder) treats an `undefined` filter value as "no filter on this field", not
    "match nothing." Without the explicit empty-check, a caller entitled to see zero mailboxes would
    instead see *every* mailbox. Verified by reading `ModelUtils.buildSearchQuerySQL` directly — not a
    theoretical concern.
- **`create()` change:** a non-trusted caller's `ownerUserUid` is now always force-set to their own uid
  server-side (previously trusted the client's own value, which happened to always match in every existing
  test but was never actually enforced). Only a trusted caller may create a mailbox with a different owner or
  none at all (`ownerUserUid` omitted → ownerless shared mailbox). `RepoUtils.create()`'s existing
  auto-owner-grant logic already skips granting a self-record to a trusted creator (`!UserUtils.hasRoles(...,
  trustedRoles)` gate, pre-existing), so an admin creating an ownerless mailbox doesn't need any extra code to
  avoid leaving a stray self-grant behind — verified by reading `RepoUtils.create()` and by a test asserting
  the resulting ACL has zero records.
- **New routes added, modeled on `ContactListRouteMongo`/`SQL` (the existing precedent for a `mailboxUid`-
  scoped entity with no `AccessControlList` of its own):** `QuarantineRouteMongo`/`SQL` and
  `IngestQueueRouteMongo`/`SQL`, both thin `BaseScopedChildRoute` subclasses with `scopeProperty =
  "mailboxUid"` — no bespoke `Base*Route` abstract layer needed since there's no shared logic beyond that.
  "Releasing" a quarantined entry is just a normal `PUT /:id` setting `releasedAt`/`releasedByUserUid` — no
  bespoke endpoint. Re-injecting a released message back into normal delivery is an explicit non-goal here
  (not implemented) — `QuarantineEntry` doesn't carry the envelope info (`envelopeFrom`/`envelopeTo`) an
  `IngestQueueEntry` would need to be reconstructed correctly, and guessing at that reconstruction (including
  how `ScanQueueJob` should treat a manually-released message differently from a freshly-arrived one) risked
  fabricating behavior nobody asked for. Flagged as a known follow-up if a real "resubmit" UX is wanted later.
- Both fixed pre-existing tests (`test/models/{mongo,sql}.test.ts`'s "falls back to class defaults" checks)
  now assert `ownerUserUid` is `undefined` by default, not `""` — this is the correct new default (a
  freshly-constructed `Mailbox` with no data is exactly the ownerless case), not a regression to paper over.

### 2026-09-06 — `BaseMessageRoute.content()`: fetch a message's body (found missing while building `mail-server`'s webmail reading pane)

- **Real gap, not a style choice**: `BaseMessageRoute` had `send()` (compose→relay) but no endpoint at all to
  fetch a message's actual body content — `findById` (from `BaseScopedChildRoute`) only ever returns the
  `Message` record itself, which carries `bodyBlobKey`/`sanitizedHtmlBlobKey` as opaque blob-store keys, not
  content. A webmail reading pane (or any other client) had no way to render a message body at all. Found
  while implementing `mail-server`'s `apps/www` inbox reading pane — its own NOTES.md Phase 3 entry has the
  consumer side.
- **Fix**: `GET /:id/content`, mirroring `BaseAttachmentRoute.download()`'s exact shape (same 404-on-missing-
  or-no-permission pattern, checked against `aclUtils.hasPermission(user, message.folderUid, ACLAction.READ)`
  — the same permission `findById` implicitly uses). Serves `sanitizedHtmlBlobKey` as `text/html` when the
  message has one (the post-`ScanPipeline` sanitized body — safe to render directly), otherwise falls back to
  `bodyPreview` as `text/plain`. **Deliberately never serves `bodyBlobKey`'s raw MIME** — that's never
  sanitized, and the doc comment says so explicitly, so a future change doesn't "helpfully" wire it in as a
  fallback.
- Tests: mongo+sql integration coverage (sanitized-HTML path, plain-text fallback, 403/404 — actually asserts
  404 for both permission-denied and not-found, matching `BaseAttachmentRoute.download`'s own choice not to
  distinguish the two) plus the usual `BaseMessageRoute.test.ts` guard-clause unit test
  (`!repoUtils`/`!blobStore` → `INTERNAL_ERROR`, the one thing a real wired server can never trigger).
- Verification: `yarn tsc --noEmit`/`yarn lint`/full `yarn vitest run` all clean (1207/1283, 76 intentionally
  skipped) except one confirmed-transient `EasRoute.test.ts` `MongoNetworkError: ECONNRESET` under the full
  suite's load — reproduced passing 76/76 in isolation immediately after, not a real regression, not
  something this change touches (EAS code wasn't modified).
- Per this repo's own standing rule, `version` in `package.json` was **not** bumped — `mail-server` needs a
  fresh `yarn patch`/`yarn patch-commit` (see that repo's NOTES.md) to pick this up locally until JP
  publishes a real release.
