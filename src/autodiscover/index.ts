///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/**
 * Autodiscover protocol compatibility: the mechanism a real mail client uses to find this deployment's EAS
 * server URL from just an email address, before it has any credentials or JWT of its own. Exports the
 * backend-agnostic surface - the request/response XML helpers and the abstract route base class. The concrete
 * Mongo/SQL classes a deployment actually instantiates (`AutodiscoverRouteMongo`/`AutodiscoverRouteSQL`) are
 * exported from this package's `./mongo`/`./sql` subpaths instead, alongside every other entity/route/job this
 * library defines - see `src/eas/index.ts`'s identical doc comment for the same convention.
 *
 * A deployment mounts Autodiscover with a trivial subclass supplying its own EAS URL:
 * ```ts
 * import { AutodiscoverRouteMongo } from "@rapidrest/mail/mongo";
 * import { RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/autodiscover")
 * export class MyAutodiscoverRoute extends AutodiscoverRouteMongo {
 *     protected readonly easUrl = "https://mail.example.com/Microsoft-Server-ActiveSync";
 *     protected readonly mapiUrl = "https://mail.example.com/mapi/emsmdb";
 * }
 * ```
 */
export * from "./AutodiscoverXml.js";
export * from "./BaseAutodiscoverRoute.js";
