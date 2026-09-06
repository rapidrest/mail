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

### 2026-09-06 — MAPI Phase 3, steps 10-14 (delete ROPs, pragmatic ICS, minimal NSPI, Autodiscover Outlook/EXCH, public surface) — **Phase 3 complete**

- **`RecoverableRepoUtils` gap found before implementing delete ROPs**: `BaseMapiEmsmdbRoute.ts` was building
  plain `RepoUtils` (not `RecoverableRepoUtils`) for `folderRepo`/`messageRepo`/`calendarEventRepo`, so a
  MAPI-driven delete would never bump `dateModified`/`version` — silently breaking EAS's own watermark-based
  incremental-sync deletion detection for anything deleted via MAPI instead of the REST API. Fixed before
  `RopDeleteMessagesHandler`/`RopDeleteFolderHandler` landed, not after.
- **`RopDeleteMessages`(0x1E)/`RopDeleteFolder`(0x1D)** confirmed against `MS-OXCROPS`; `DeleteFolderFlags`
  bits (`DEL_MESSAGES`/`DEL_FOLDERS`/`DELETE_HARD_DELETE`) map directly onto `RepoDeleteOptions.purge`.
- **FastTransfer (`RopFastTransferSourceCopyTo`/`CopyProperties`/`GetBuffer`)**: this pragmatic subset always
  builds a full, non-differential dump — no real IDSET/`IncrSyncChg`/`IncrSyncDel` grammar, which needs
  persisted per-device state this library doesn't implement. A real client still works correctly against
  this (it reconciles by diffing the dump against its own local cache); it's just less efficient than
  byte-perfect ICS. `RopFastTransferSourceCopyTo`'s `CopyFlags` is 4 bytes; `CopyProperties`'s own `CopyFlags`
  is 1 byte — confirmed via spec, easy to get wrong by assuming they match.
- **NSPI (`/mapi/nspi`) deliberately has no real session state** between `Bind` and later calls — every
  operation independently re-authenticates via the same JWT and re-resolves the caller's mailbox, since the
  real spec's session cookie mainly serves multi-server-farm request affinity, not additional auth. `Bind`
  mints an opaque, unvalidated `NspiContext` cookie purely for wire-format conformance.
- **Design principle reused twice this session, worth keeping in mind for any future variant-length-structure
  decoder**: when a structure's byte length is type/variant-dependent and only some variants are understood,
  the decoder must either fully consume the exact right number of bytes or throw — never silently return a
  "not applicable" value while leaving the reader mid-structure, since that corrupts every subsequently-
  decoded field. Caught in `extractContentRestrictionSearchTerm` (`NspiCodec.ts`) before implementation: it
  throws for any non-`RES_CONTENT` restriction type rather than returning `undefined`.
- **Commit-message rewrite scope, settled**: only the 18 commits ahead of `origin/main`'s `0.2.0` tag were
  rewritten via `git filter-branch --msg-filter` (verified via an empty `git diff` against a backup branch);
  already-published history was deliberately left alone — see the entry above this one for the full reasoning
  (unchanged, just noting the backup branch `backup-before-msg-rewrite-2026-09-06` is still present locally).
- **Autodiscover Outlook/EXCH extension (step 13)**: real Outlook desktop finds `/mapi/emsmdb` via the classic
  POX "Outlook" namespace (`AcceptableResponseSchema` = `.../outlook/responseschema/2006a`), a different
  response shape from the EAS-only MobileSync response `BaseAutodiscoverRoute.pox()` already served. Confirmed
  the exact XSD via `WebFetch` against the real `[MS-OXDSCLI]` spec pages (not a WebSearch summary — the first
  WebSearch pass returned a plausible-looking but unverified summary, correctly not trusted until a direct
  spec-page fetch confirmed it field-by-field).
  - **Key confirmed fact**: `[MS-OXDSCLI]`'s "Processing the X-MapiHttpCapability Header" section states a
    mapiHttp-capable client's response **MUST** carry a `Protocol` element with `Type`/`Version` as XML
    *attributes* (`<Protocol Type="mapiHttp" Version="1">`), not the classic `<Type>EXCH</Type>` **child
    element** used for RPC/TCP MAPI — and **MUST NOT** include an EXCH/EXPR protocol block at all when doing
    so. The two forms are mutually exclusive by spec, not just alternatives — easy to get wrong by trying to
    include both "for compatibility."
  - Since this library only speaks MAPI/HTTP (no classic RPC/TCP MAPI transport), `buildOutlookSuccessXml()`
    always returns the mapiHttp form and never negotiates via the real `X-MapiHttpCapability` request header —
    documented as a deliberate simplification, not an oversight.
  - `LegacyDN`/`DeploymentId` are schema-required fields with no real backing concept in this library (no
    X.500 DN resolution, no multi-tenant deployment identity) — both are synthesized placeholders; real
    Outlook doesn't validate their exact content for MAPI/HTTP connectivity specifically.
  - `BaseAutodiscoverRoute` gained an abstract `mapiUrl` property (sibling to `easUrl`) and `pox()` now
    branches on `extractAcceptableResponseSchema(body)` to pick `buildOutlookSuccessXml` vs the original
    `buildPoxSuccessXml`.
- **Step 14 (public surface) found a real pre-existing gap**: `src/mongo.ts`/`src/sql.ts` (the root
  `@rapidrest/mail/mongo`/`/sql` aggregators) never included `./mapi/mongo.js`/`./mapi/sql.js` at all — the
  flat `src/mapi/mongo.ts`/`sql.ts` re-export files that mirror `src/eas/mongo.ts`/`sql.ts` didn't exist yet
  either, and `MapiNspiRouteMongo`/`SQL` were missing from `src/mapi/mongo/index.ts`/`sql/index.ts` (only
  `MapiEmsmdbRouteMongo`/`SQL` had been added back in step 3). All fixed together; `src/mapi/index.ts` itself
  now re-exports every backend-agnostic codec/ROP-handler/NSPI-handler class (each takes a generic
  `RopContext`/repo argument, so none of them needed a Mongo/SQL split).
- **Phase 3 is now fully complete** (steps 1-14). Full-suite verification (`tsc --noEmit`/`eslint`/
  `vitest run --coverage`): 1484/1484 tests pass; the only global-threshold misses are the pre-existing
  Phase 1/Phase 2 gaps noted below (unrelated to Phase 3, not fixed here to avoid scope creep).
- **Full-suite coverage audit finding, not fixed in this session (out of scope for Phase 3)**: running the
  *entire* `npx vitest run --coverage` (not just the touched files) surfaces small, pre-existing statement/
  function/line gaps in several Phase 1/Phase 2 files never touched this session —
  `EmailSyncAdapter.ts`, `SendMailCommand.ts`, `ProvisionCommand.ts`, `PingCommand.ts`, `SearchCommand.ts`,
  `SyncCommand.ts`, `CalendarStorageRecalcJob.ts`, `ScanQueueJob.ts`, `MailboxRoute.ts`, `MessageRoute.ts`,
  `ChildRoute.ts`, `MailIngestRoute.ts`, `FolderRoute.ts`, `CalendarShareLinkRoute.ts`,
  `MailboxRouteMongo.ts`/`SQL.ts`, `PlainTextExtractor.ts` — overall 99.8-99.9% stmt/func/line (branches are
  fine at 98%, above the ≥95% floor). None of these are files this session touched, and verifying "clean"
  per-step against only the touched test files (the practice this whole project has followed) never surfaces
  them. Worth a dedicated cleanup pass later; not addressed here to avoid scope creep into unrelated
  already-shipped phases while mid-way through Phase 3's own step sequence.

### 2026-09-06 — MAPI Phase 3, Calendar sub-phase (steps 9a-9f)

- **New Outlook / Graph API reality check** (settled, don't re-litigate): researched whether to pivot MAPI
  work toward Microsoft Graph API instead, since "New Outlook"/mobile/web Outlook don't speak MAPI at all.
  Finding: Graph API is Microsoft's own cloud service, not an implementable protocol a third-party server can
  serve stock clients over — New Outlook currently has zero on-prem Exchange connectivity via *any* protocol.
  MAPI/HTTP itself is current (not deprecated), just narrow in scope (classic Windows desktop Outlook only).
  Decision: continue MAPI as planned; EAS already covers mobile/iOS Mail; a future IMAP/SMTP phase would be
  the way to reach New Outlook, not a Graph API implementation.
- **Named properties were a real, missing ROP** — almost every Appointment property (start/end, location,
  busy status, recurrence, reminder) is a *named* property (`PidLid*`), not a fixed-numeric `PidTag*`. A
  client must resolve each one via `RopGetPropertyIdsFromNames` first. This wasn't in the original Phase 3
  plan and was caught by research before writing Calendar code, not after — worth remembering as the shape of
  gap to watch for before starting a new ROP area (check MS-OXPROPS for `PtypInteger32`-adjacent surprises).
  Session-scoped mapping lives in `NamedPropertyRegistry.ts` (`MapiSessionContext.namedProperties`), same
  linear-registry pattern as `FolderTarget.assignOrGetFid`/`MessageTarget.assignOrGetMid`.
- **Calendar named-property GUID/LID table** (`src/mapi/rop/CalendarNamedProperties.ts`) — confirmed one-by-one
  against live MS-OXPROPS pages this session (not invented/recalled from memory), shared by both the read side
  (`PropertyResolvers.calendarEventValueFor`) and write side (`RopSaveChangesMessageHandler`'s decode). If a
  future session needs another Calendar property, look it up fresh the same way rather than trusting recall.
- **Meeting invites use nodemailer's `MailComposer` `icalEvent` option** (`{method: "REQUEST", content: ics}`)
  — produces the correct dual form (a `text/calendar; method=REQUEST` MIME alternative *and* an `.ics`
  attachment) automatically. No need to hand-build multipart MIME for calendar invites; only the ICS text
  itself needs hand-building.
- **`PidLidGlobalObjectId` needs no persisted correlation field** — since this server always generates the
  invite's `GlobalObjectId` itself, embedding `CalendarEvent.icalUid` directly in the structure's own
  `Data` bytes (`GlobalObjectId.ts`) makes decoding a real client's meeting-response payload back to the
  original event a direct lookup, not a new schema field.
- **Two real bugs found via testing, not review** (both now fixed, both worth the reminder that MAPI's own
  target-string/session conventions are easy to get subtly wrong): `CalendarEventTarget`'s organizer
  resolution used `event?.organizer.address` (chains on `event`, not `.organizer` — crashes if `organizer` is
  ever missing); a fresh appointment's `folderUid` was persisted as the raw `"folder:<uid>"` session *target
  string* (`MapiObjectHandle.draftFolderUid`'s actual format) instead of the bare `Folder.uid`.
- **Commit message rewrite**: at JP's request, rewrote all 18 locally-unpushed commit messages (everything
  ahead of `origin/main`'s `0.2.0` tag) to match the tightened commit-message rule above (plain one-line-per-
  item, no prose paragraphs) via `git filter-branch --msg-filter`, verified byte-identical trees before/after.
  Already-published history (at/before `c44a714`) was deliberately left untouched — rewriting *that* would
  need a force-push and could break other clones/`mail-server`'s `yarn patch` consumption; that's a
  materially bigger, separate decision from cleaning up local-only history.

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
