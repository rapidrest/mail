# RapidREST: Mail Library

[![CI](https://github.com/rapidrest/mail/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/rapidrest/mail/actions/workflows/build.yml)
[![Coverage Status](https://coveralls.io/repos/github/rapidrest/mail/badge.svg?branch=main)](https://coveralls.io/github/rapidrest/mail?branch=main)
[![npm version](https://img.shields.io/npm/v/@rapidrest/mail)](https://www.npmjs.com/package/@rapidrest/mail)

A library for building a complete mail server on RapidREST — reachable entirely over HTTP/S — aiming for
compatibility with MAPI over HTTP (Outlook desktop), Exchange ActiveSync (mobile clients), and a standard
RapidREST REST API for webmail/other downstream clients. Integrates Contacts, Calendar (with external sharing
and scheduling), Notes/Tasks, full-text search over mail/attachments, and pluggable SPAM/anti-virus scanning.

Internet mail transport (inbound/outbound SMTP) is intentionally out of scope for this library — it hands off
to a dedicated MTA (Postfix recommended) via a narrow internal HTTP ingestion boundary. No client (Outlook/EAS/
webmail) ever speaks SMTP/IMAP/POP to this library directly.

## Status

This library is under active development. Phase 1 (the core data model, the standard RapidREST CRUD API, mail
ingestion/scanning/search), Phase 2 (Exchange ActiveSync), Autodiscover, and Phase 3 (MAPI over HTTP) are all
complete.

Exchange ActiveSync support (`@rapidrest/mail/eas`) covers the pragmatic command subset a real mobile client
(iOS Mail, Outlook mobile, Android/Samsung Mail) needs for day-to-day use: `Provision`, `FolderSync`, `Sync`
(`Email`/`Contacts`/`Calendar`/`Tasks`), `SendMail`/`SmartForward`/`SmartReply`, `ItemOperations`, `Ping`,
`Search` (GAL), `MeetingResponse`, and `Settings`. It authenticates with the same JWT the rest of this library's
routes already use — no separate EAS-specific login flow — which means a real native device (rather than a
test client that already has a token) needs an OAuth 2.0 Authorization Server role in front of it to obtain
one; that piece is tracked as a follow-up in `@rapidrest/auth`, not this library.

MAPI over HTTP support (`@rapidrest/mail/mapi`) covers the pragmatic subset a real Outlook desktop client (and
the "New Outlook"/Monarch client, for on-prem/hybrid mailboxes) needs: mailbox logon, folder/message browsing,
compose/send, full Calendar CRUD including meeting invites/responses, deletion, a pragmatic (full-dump, not
byte-perfect ICS) incremental sync, and a minimal NSPI address-book endpoint (`Bind`/`Unbind`/`GetMatches`) for
GAL "search as you type." Like EAS, it authenticates with the same JWT the rest of this library's routes
already use — no MAPI-specific auth code, and the same OAuth 2.0 Authorization Server follow-up noted above
applies to real native Outlook clients too. Documented gaps: no byte-perfect ICS (a real client still works
correctly against the full-dump form, just less efficiently); no counter-proposals, meeting-forwarding,
delegate scheduling, or resource-booking auto-accept; no DST-aware timezones (fixed-offset approximation
only); no recurrence exceptions; no `RopModifyRecipients`; no public-folder support; no delegate/shared-mailbox
access; no rules/permissions/search-folder ROPs; no client-certificate enrollment; NSPI limited to
`Bind`/`Unbind`/`GetMatches` only.

Autodiscover support (`@rapidrest/mail/autodiscover`) lets a real client find this deployment's EAS and MAPI
server URLs from just an email address — classic POX (`POST /autodiscover/autodiscover.xml`, serving either
the EAS-only MobileSync response or, when a real Outlook desktop client requests it via
`AcceptableResponseSchema`, an Outlook/EXCH response pointing at the MAPI/HTTP endpoint) and the modern JSON
variant Microsoft calls "Autodiscover v2" (`GET /autodiscover/autodiscover.json/v1.0/<email>?Protocol=ActiveSync`,
EAS only — this library has no separate JSON discovery variant for MAPI). Both endpoints are intentionally
unauthenticated, matching Autodiscover v2's own spec design: they reveal nothing but deployment-wide server
URLs (not secrets) once the requested address is confirmed to belong to a real mailbox here — real mailbox
access is still fully gated by the JWT-protected EAS/MAPI/REST layers, unchanged from above. For a real device
to find these endpoints at all, the deployment's DNS needs a `CNAME` record for `autodiscover.<your-domain>`
(and, optionally, a `_autodiscover._tcp` `SRV` record) pointing at wherever this server is mounted — an
ops/deployment task, not something this library configures.

## Usage

Pick a persistence backend by importing the matching subpath — `@rapidrest/mail/mongo` or `@rapidrest/mail/sql`
— alongside the protocol-agnostic root import:

```ts
import { MailboxRouteMongo, FolderRouteMongo, MessageRouteMongo } from "@rapidrest/mail/mongo";
```

Register a `BlobStore`, `SearchProvider`, `SpamScanProvider`, `AvScanProvider`, and `MailTransport`
implementation with your application's dependency injection container before starting the server — see
`src/blob/BlobStore.ts`, `src/search/SearchProvider.ts`, `src/scan/SpamScanProvider.ts`/`AvScanProvider.ts`,
and `src/transport/MailTransport.ts` for the interfaces and their default implementations.

To also serve Exchange ActiveSync, mount `EasRouteMongo`/`EasRouteSQL` at the protocol's well-known path with a
one-line subclass:

```ts
import { EasRouteMongo } from "@rapidrest/mail/mongo";
import { RouteDecorators } from "@rapidrest/service-core";
const { Route } = RouteDecorators;

@Route("/Microsoft-Server-ActiveSync")
export class MyEasRoute extends EasRouteMongo {}
```

To also serve MAPI over HTTP, mount `MapiEmsmdbRouteMongo`/`SQL` (mailbox/store access) and
`MapiNspiRouteMongo`/`SQL` (address book) at their conventional paths, each with a trivial one-line subclass:

```ts
import { MapiEmsmdbRouteMongo, MapiNspiRouteMongo } from "@rapidrest/mail/mongo";
import { RouteDecorators } from "@rapidrest/service-core";
const { Route } = RouteDecorators;

@Route("/mapi/emsmdb")
export class MyMapiEmsmdbRoute extends MapiEmsmdbRouteMongo {}

@Route("/mapi/nspi")
export class MyMapiNspiRoute extends MapiNspiRouteMongo {}
```

To also serve Autodiscover, mount `AutodiscoverRouteMongo`/`AutodiscoverRouteSQL` with a one-line subclass
supplying the EAS and MAPI URLs from above:

```ts
import { AutodiscoverRouteMongo } from "@rapidrest/mail/mongo";
import { RouteDecorators } from "@rapidrest/service-core";
const { Route } = RouteDecorators;

@Route("/autodiscover")
export class MyAutodiscoverRoute extends AutodiscoverRouteMongo {
    protected readonly easUrl = "https://mail.example.com/Microsoft-Server-ActiveSync";
    protected readonly mapiUrl = "https://mail.example.com/mapi/emsmdb";
}
```
