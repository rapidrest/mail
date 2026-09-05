///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { HttpRequest, HttpResponse, ObjectFactory, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { buildPoxSuccessXml, extractEmailAddress } from "./AutodiscoverXml.js";
import { Mailbox } from "../models/types.js";
const { Init, Logger } = ObjectDecorators;
const { Get, Param, Post, Query, Request, Response } = RouteDecorators;

/**
 * Abstract base for the two Autodiscover endpoints a real mail client uses to find this deployment's EAS
 * server URL from just an email address - classic POX (`POST /autodiscover/autodiscover.xml`, per
 * `[MS-ASCMD]`'s "MobileSync" response schema) and the modern JSON variant Microsoft calls "Autodiscover v2"
 * (`GET /autodiscover/autodiscover.json/v1.0/<email>?Protocol=ActiveSync`). Like `BaseMailIngestRoute`/
 * `BaseEasRoute`, this class is undecorated - the consuming application mounts it:
 * ```ts
 * import { AutodiscoverRouteMongo } from "@rapidrest/mail/mongo";
 * import { RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/autodiscover")
 * export class MyAutodiscoverRoute extends AutodiscoverRouteMongo {
 *     protected readonly easUrl = "https://mail.example.com/Microsoft-Server-ActiveSync";
 * }
 * ```
 * which composes with this class's own relative method paths to land exactly on the real spec's conventional
 * paths (`/autodiscover/autodiscover.xml`, `/autodiscover/autodiscover.json/v1.0/:email`).
 *
 * **Auth: deliberately none.** Real classic Autodiscover conventionally expects the client to send HTTP Basic
 * credentials (email+password), with the server free to answer `401` and force re-entry - a model this
 * library's JWT-only, no-credential-verification-of-our-own boundary (see `BaseEasRoute`'s own doc comment on
 * why per-request Basic Auth was rejected there) can't and shouldn't absorb; no credential-verification
 * function exists in this codebase or its dependencies. Instead, both endpoints here follow Microsoft's own
 * Autodiscover v2 design intent exactly: answer anonymously, and reveal nothing but a deployment-wide,
 * config-supplied EAS server URL - not a per-mailbox secret - once the request email is confirmed to belong to
 * a real `Mailbox` in this deployment. The actual security boundary is unchanged from Phase 2: real mailbox
 * access still requires a JWT at `BaseEasRoute`, exactly as today.
 *
 * **Known gap, deliberately out of scope**: `Action.Redirect` (for multi-tenant hosted providers whose mailbox
 * moved to a different domain) is not implemented - this library serves exactly one EAS URL for its whole
 * deployment, so there's never a different domain to redirect to. The client-side well-known-URL discovery
 * sequence (`MS-OXDISCO`: root domain -> `autodiscover.` subdomain -> unauthenticated HTTP redirect probe ->
 * DNS SRV record -> cache) and the DNS `CNAME`/`SRV` record setup it depends on are also out of scope here -
 * both are client/deployment concerns, not application code; this class only needs to answer correctly once a
 * request actually arrives at one of its two paths.
 *
 * `mailboxClass` is supplied by the Mongo/SQL concrete subclasses following the exact one-line-per-backend
 * pattern used throughout this library. `easUrl` remains abstract even after that - it's a deployment-specific
 * value only the consuming application's own subclass can supply.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseAutodiscoverRoute<M extends Mailbox> {
    protected abstract mailboxClass: any;

    /** The EAS endpoint URL to report - e.g. `https://mail.example.com/Microsoft-Server-ActiveSync`, matching
     * whatever `@Route(...)` path the deployment mounted its `BaseEasRoute` subclass at. */
    protected abstract readonly easUrl: string;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private mailboxRepo?: RepoUtils<M>;

    @Logger
    private logger: any;

    /**
     * Builds the query value used to match `Mailbox.aliasAddresses` against the given address. See
     * `BaseMailIngestRoute.aliasQueryValue()`'s identical doc comment - same Mongo-array vs.
     * SQL-`simple-json`-column backend split, same override point (`AutodiscoverRouteSQL` overrides this
     * identically to `MailIngestRouteSQL`).
     */
    protected aliasQueryValue(address: string): any {
        return address;
    }

    @Init
    public async init(): Promise<void> {
        this.mailboxRepo = await this._objectFactory!.newInstance(RepoUtils, {
            name: this.mailboxClass.name,
            args: [this.mailboxClass],
        });
    }

    private async resolveMailbox(email: string): Promise<M | undefined> {
        const address: string = email.trim().toLowerCase();
        const [byPrimary, byAlias] = await Promise.all([
            this.mailboxRepo!.find({ primarySmtpAddress: address }, { ignoreACL: true, limit: 1 }),
            this.mailboxRepo!.find({ aliasAddresses: this.aliasQueryValue(address) }, { ignoreACL: true, limit: 1 }),
        ]);
        return byPrimary[0] ?? byAlias[0];
    }

    /**
     * Classic POX Autodiscover. Per Microsoft's own client-behavior documentation, a permanent failure is just
     * as validly conveyed via a plain HTTP status as via an inner `Error` element, so this uses the HTTP-status
     * form for both error cases rather than inventing values for `[MS-ASCMD]`'s provider-specific numeric
     * error-code table.
     */
    @Post("/autodiscover.xml")
    public async pox(@Request req: HttpRequest, @Response res: HttpResponse): Promise<void> {
        if (!this.mailboxRepo) {
            res.status(500).send();
            return;
        }

        const body: string = req.rawBody ? req.rawBody.toString("utf-8") : "";
        const email: string | undefined = extractEmailAddress(body);
        if (!email) {
            res.status(400).send();
            return;
        }

        const mailbox: M | undefined = await this.resolveMailbox(email);
        if (!mailbox) {
            res.status(404).send();
            return;
        }

        const xml: string = buildPoxSuccessXml({
            emailAddress: email,
            displayName: mailbox.displayName,
            easUrl: this.easUrl,
        });
        res.setHeader("Content-Type", "application/xml; charset=utf-8").status(200).send(xml);
    }

    /**
     * Autodiscover v2 (JSON). Only the `ActiveSync` protocol is served - this library has no EWS/other
     * protocol surface to advertise - so any other `Protocol` value is rejected outright rather than silently
     * answered with an EAS URL under the wrong protocol name.
     */
    @Get("/autodiscover.json/v1.0/:email")
    public async v2(
        @Param("email") email: string,
        @Query("Protocol") protocol: string | undefined,
        @Response res: HttpResponse,
    ): Promise<void> {
        if (!this.mailboxRepo) {
            res.status(500).send();
            return;
        }
        if (protocol !== "ActiveSync") {
            res.status(400).json({
                ErrorCode: "ProtocolNotSupported",
                ErrorMessage: `Unsupported protocol: ${protocol ?? ""}`,
            });
            return;
        }

        const mailbox: M | undefined = await this.resolveMailbox(decodeURIComponent(email));
        if (!mailbox) {
            res.status(404).json({
                ErrorCode: "UserNotFound",
                ErrorMessage: "No mailbox exists for the given address.",
            });
            return;
        }

        res.status(200).json({ Protocol: "ActiveSync", Url: this.easUrl });
    }
}
