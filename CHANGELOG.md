# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-05

### Added
- Added WBXML codec for Exchange ActiveSync (Phase 2, step 2)
- Added BaseEasRoute transport skeleton for Exchange ActiveSync (Phase 2, step 3)
- Added Autodiscover support (POX + v2 JSON) ahead of MAPI over HTTP
- Added @rapidrest/cli

### Changed
- Migrate Folder/Message/Contact/CalendarEvent/Task to soft delete
- Exchange ActiveSync needs to tell an already-synced device that an
- item was deleted, but these entities were hard-deleted with no trace.
- Move them to RecoverableBaseEntity and add a mail-local
- RecoverableRepoUtils that also bumps dateModified/version on soft
- delete (service-core's own soft-delete path only sets the deleted
- flag), so a dateModified watermark query can observe a deletion the
- same way it observes an ordinary field change.
- Wired in via the existing repoUtilsClass extension point on every
- affected route, and in the job/route helpers that build a RepoUtils
- for one of these entities directly. Updates the handful of Phase 1
- tests that queried the raw driver directly and expected a deleted
- record to be gone rather than soft-deleted.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Implements the binary WBXML encode/decode engine EAS runs on top of:
- a tagged-tree WbxmlElement model, an encoder/decoder pair handling
- the wire mechanics (header, SWITCH_PAGE, tag content/attribute flag
- bits, STR_I, OPAQUE, mb_u_int32 varints), and code-page tag tables
- for every page this library's planned command subset touches.
- Token values for AirSync and FolderHierarchy are transcribed directly
- from the published MS-ASWBXML spec; the remaining pages come from
- Z-Push's wbxmldefs.php, a production ActiveSync server whose tables
- are necessarily byte-exact against real devices.
- Verified against a real captured ActiveSync request byte-for-byte
- (from Microsoft's own worked WBXML decoding example), not just
- internal encode/decode round-tripping, plus round-trip tests for
- opaque content, multi-page documents, and error paths.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Wires the WBXML codec into a real HTTP endpoint: one POST handler
- dispatching on ?Cmd= (JWT-authenticated, reusing the framework's
- existing default strategy - no new auth code), resolving the caller's
- own mailbox, finding-or-creating that device's DeviceSyncState,
- enforcing the provisioning gate (HTTP 449 for an unprovisioned device
- on any command but Provision/Settings), and decoding/encoding request
- and response bodies via WbxmlDecoder/Encoder. Command handlers are
- supplied via an empty, overridable registry - every command 501s
- until a concrete handler lands, which is the correct behavior for a
- transport-only skeleton.
- Dropped the originally-planned OPTIONS-based protocol discovery
- handler: Server.ts's global CORS middleware unconditionally answers
- every OPTIONS request with a bare 204 before an app route ever runs,
- confirmed by reading the source and by a real HTTP test against this
- route, so an app-level @Options() handler here would be dead code.
- Documented as a known limitation pointing at the real fix (a
- service-core CORS change), not worked around locally.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Implement EAS Provision, FolderSync, and Ping commands (Phase 2, step 4)
- Adds the SyncKey cursor mechanism (watermark-based Add/Change/Delete
- enumeration over RecoverableBaseEntity collections), the two-phase
- Provision handshake, FolderSync's folder-hierarchy sync, and a
- Redis-pub/sub-backed Ping long-poll. Fixes two real bugs found via
- integration testing: FolderSync's initial-sync watermark must be the
- epoch (not "now") so a device's first real sync sees all existing
- folders, and RepoUtils.find() doesn't honor includeDeleted, so deleted
- rows are now fetched via an explicit deleted:true query instead.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Implement EAS Sync command for Email collections (Phase 2, step 5)
- Adds SyncCommand, a generic per-folder Add/Change/Delete enumerator
- reusing FolderSyncCommand's watermark-cursor mechanism (EasSyncKeyUtils),
- scoped by folderUid instead of mailboxUid, and dispatched per
- MS-ASCMD Class value via a new EasCollectionSyncAdapter interface.
- EmailSyncAdapter is the first adapter, mapping Message to the EAS
- Email/AirSyncBase wire fields (subject, From/To/Cc, importance,
- read/flagged state, and a truncated body preview - full body fetch is
- deferred to a future ItemOperationsCommand). Contacts/Calendar/Tasks
- adapters land in a later step by adding more collectionBindings
- entries, not by changing SyncCommand itself.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Implement EAS SendMail/SmartForward/SmartReply commands (Phase 2, step 6)
- Adds ComposeMailCommand, a shared implementation for the three
- MS-ASCMD ComposeMail commands: parses the client-submitted raw MIME
- (opaque WBXML "MIME" element), scans and relays it via the same
- scan-then-relay core BaseMessageRoute.send() now also uses (refactored
- into util/MailSendUtils.ts's scanAndRelay(), removing the duplicated
- logic), and optionally persists a Sent Items copy. SmartForward/
- SmartReply additionally resolve the referenced original message via
- Source/ItemId to thread inReplyTo/references and flip the original's
- Forwarded/Answered flag.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Implement EAS Contacts/Calendar/Tasks Sync adapters (Phase 2, step 7)
- Adds ContactsSyncAdapter (MS-ASCONTACTS: names, positional email
- slots, Home/Business/Other phones and addresses), CalendarSyncAdapter
- (MS-ASCAL: attendees, BusyStatus/AttendeeStatus/AttendeeType/
- Recurrence.Type numeric codes verified against the published spec),
- and TasksSyncAdapter (MS-ASTASK), wired into SyncCommand's existing
- collectionBindings alongside Email - no changes to SyncCommand itself.
- Real cross-backend integration testing caught two genuine bugs before
- they could reach a device: RecurrenceRule.until/count live inside a
- SQL simple-json column, so they round-trip as plain strings there
- (unlike Mongo's native BSON dates) - toCompactDateTime() now accepts
- Date | string and normalizes. Separately, CalendarEventSQL's nullable
- reminderMinutesBeforeStart column hydrates as `null`, not `undefined`,
- so the adapter's presence check now uses `!= null` instead of a
- strict `!== undefined` comparison.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Implement EAS ItemOperations, Search, MeetingResponse, and Settings commands (Phase 2, step 8)
- Adds the final four commands in the pragmatic subset:
- - ItemOperationsCommand: Fetch for a Message's full body (sanitized
- HTML if available, else parsed plain text) or an Attachment's raw
- content (base64-inlined), reusing the same BlobStore read path
- BaseAttachmentRoute.download() already uses.
- - SearchCommand: GAL lookup against a mailbox's own Contacts via
- simple substring matching, not the heavier SearchProvider index.
- - MeetingResponseCommand: accept/tentative/decline updates the
- caller's own Attendee record in place (matched by the mailbox's
- primary or alias SMTP address), per the approved plan.
- - SettingsCommand: UserInformation/Get (primary + alias addresses)
- and DeviceInformation/Set (acknowledged, not persisted).
- Real cross-backend integration testing caught two further genuine
- bugs in SearchCommand before they could reach a device: this
- framework's $or query operator is Mongo-only (buildSearchQuerySQL has
- no handling for it at all, silently building a broken TypeORM where
- clause on SQL) - fixed by querying each field separately and merging
- in memory, the same pattern EasSyncKeyUtils.computeChanges() already
- uses for its own cross-backend query gap. Separately, the two
- backends' like() operator has different substring semantics (Mongo:
- unanchored regex; SQL: TypeORM ILike(), exact unless %-wrapped) - each
- backend's concrete SearchCommand subclass now supplies its own
- wildcard-wrapping via a new likePattern() hook.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Wire up the real EAS public export surface, completing Phase 2 (step 9)
- Replaces src/eas/index.ts's EAS_NOT_YET_IMPLEMENTED stub with the
- actual backend-agnostic public surface (codec, BaseEasRoute,
- EasCommandHandler/context types, EasSyncKeyUtils, CompactDateTime,
- every command's abstract base class, and the Sync collection
- adapters) exported via the existing `@rapidrest/mail/eas` subpath.
- The concrete Mongo/SQL classes (EasRouteMongo/SQL and each command's
- per-backend variant) are wired into the existing top-level ./mongo
- and ./sql subpaths instead, via new src/eas/mongo.ts and
- src/eas/sql.ts barrels - the same "backend-agnostic base classes at
- the dedicated subpath, concrete classes bundled into ./mongo|./sql
- alongside every other entity/route/job" convention this library
- already uses elsewhere (see src/routes/index.ts vs
- src/routes/mongo.ts).
- Updates the README's Status section to reflect Phase 2's completion
- and adds a mounting example for the EAS route.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Lets a real mail client find this deployment's EAS server URL from just an
- email address, via classic POX (/autodiscover/autodiscover.xml) and the
- modern Autodiscover v2 JSON variant. Both endpoints are deliberately
- unauthenticated, mirroring Autodiscover v2's own spec design: they reveal
- only a deployment-wide EAS URL after confirming the address belongs to a
- real Mailbox, never a per-mailbox secret - actual mailbox access stays
- gated by the existing JWT-protected EAS layer.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Swapped to CLI release tool

[Unreleased]: https://github.com/rapidrest/mail/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rapidrest/mail/compare/v0.1.0...v0.2.0
