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
ingestion/scanning/search) and Phase 2 (Exchange ActiveSync) are complete. MAPI over HTTP (Phase 3) has not
been implemented yet.

Exchange ActiveSync support (`@rapidrest/mail/eas`) covers the pragmatic command subset a real mobile client
(iOS Mail, Outlook mobile, Android/Samsung Mail) needs for day-to-day use: `Provision`, `FolderSync`, `Sync`
(`Email`/`Contacts`/`Calendar`/`Tasks`), `SendMail`/`SmartForward`/`SmartReply`, `ItemOperations`, `Ping`,
`Search` (GAL), `MeetingResponse`, and `Settings`. It authenticates with the same JWT the rest of this library's
routes already use — no separate EAS-specific login flow — which means a real native device (rather than a
test client that already has a token) needs an OAuth 2.0 Authorization Server role in front of it to obtain
one; that piece is tracked as a follow-up in `@rapidrest/auth`, not this library.

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
