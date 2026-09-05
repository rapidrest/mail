///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import { type JWTUser } from "@rapidrest/core";
import { HttpRequest, RouteDecorators } from "@rapidrest/service-core";
import { BaseScopedChildRoute } from "./BaseScopedChildRoute.js";
import { CalendarShareLink } from "../models/types.js";
const { Request, User: AuthUser } = RouteDecorators;

/**
 * Extends `BaseScopedChildRoute` (scoped by `folderUid`) for `CalendarShareLink` with a `create()` override
 * that always mints `token` server-side, discarding any value the client supplied for it.
 *
 * `token` is the sole credential an anonymous, unauthenticated caller will eventually present to consume a
 * share link (see the doc comment on `CalendarShareLink.token` in `models/types.ts`) — its entire security
 * value rests on being unguessable. Letting a client set it directly (the previous behavior, inherited
 * unmodified from `BaseScopedChildRoute.create()`) would let an attacker mint a link with a short, predictable,
 * or intentionally-reused token, defeating that guarantee before an anonymous consumption endpoint is ever
 * built against it.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseCalendarShareLinkRoute<T extends CalendarShareLink> extends BaseScopedChildRoute<T> {
    public async create(obj: T | T[], @Request req: HttpRequest, @AuthUser user?: JWTUser): Promise<T | T[]> {
        for (const single of Array.isArray(obj) ? obj : [obj]) {
            (single as any).token = crypto.randomBytes(32).toString("base64url");
        }
        return await super.create(obj, req, user);
    }
}
