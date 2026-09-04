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

This library is under active development. The current focus (Phase 1) is the core data model, the standard
RapidREST CRUD API, mail ingestion/scanning/search. Exchange ActiveSync (Phase 2) and MAPI over HTTP (Phase 3)
have not been implemented yet.

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
