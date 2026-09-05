///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ApiError } from "@rapidrest/core";
import { ApiErrorMessages, ApiErrors, DocDecorators, ObjectFactory, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { BusyStatus, CalendarEvent, CalendarEventStatus, CalendarShareLink } from "../models/types.js";
const { Description, Summary } = DocDecorators;
const { Get, Param, Query } = RouteDecorators;

/** What an anonymous caller sees for one busy period — no title, location, attendees, or other event detail. */
export interface FreeBusyPeriod {
    start: Date;
    end: Date;
}

/**
 * Implements anonymous, unauthenticated consumption of a `CalendarShareLink` — the "someone clicks a public
 * calendar share link" half of the feature (see `models/types.ts`'s doc comment on `CalendarShareLink.token`),
 * complementing the authenticated CRUD management of share links `BaseScopedChildRoute`/
 * `CalendarShareLinkRouteMongo`/`SQL` already provide.
 *
 * Deliberately does NOT go through `ACLUtils`/`AccessControlList` at all — `CalendarShareLink.token` is a
 * narrow, bearer-style grant (like a signed URL), not an identity `ACLUtils.hasPermission()` could resolve a
 * record for. This route looks the token up directly, checks `expiresAt` and `permittedActions` itself, and
 * scopes every subsequent read strictly to that link's own `folderUid` — a valid token for one calendar can
 * never be used to read a different folder/mailbox's events, since `folderUid` is always taken from the
 * *resolved link*, never from client input.
 *
 * Two response shapes. With no `?view=` query param, the default is the broadest view the link grants
 * (`"read"` if `permittedActions` includes it, else `"freebusy"` — `"read"` always implies `"freebusy"`, so
 * `permittedActions` never needs to list both). An explicit `?view=freebusy`/`?view=read` is always honored
 * exactly as requested — including a `"read"`-permitted link answering `?view=freebusy` for a caller that only
 * wants availability, not details — or rejected with `403` if the link doesn't grant it, never silently
 * substituted for a different view than what was explicitly asked for:
 * - **`freebusy`** — a list of `{start, end}` busy periods only (see `FreeBusyPeriod`), for any non-cancelled
 * event whose `busyStatus` is not `FREE`. No title, location, attendees, or other detail is ever included in
 * this view, matching the privacy expectation of a public free/busy link.
 * - **`read`** — the folder's `CalendarEvent` records in full.
 *
 * A full RFC 5545 `VFREEBUSY`/ICS response is deferred pending an `IcsUtils` helper for composing ICS payloads,
 * which does not exist in this codebase yet (see `MeetingSchedulingJob`'s doc comment for the same dependency) —
 * this returns plain JSON instead, matching this library's existing "pragmatic subset, not full protocol
 * fidelity" scope elsewhere.
 *
 * !!Note!! like `BaseMailIngestRoute`, this class is not automatically registered with a server — the
 * consuming application must apply `@Route(...)` to its own subclass.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseCalendarFreeBusyRoute<L extends CalendarShareLink, E extends CalendarEvent> {
    protected abstract shareLinkClass: any;
    protected abstract calendarEventClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private shareLinkRepo?: RepoUtils<L>;
    private calendarEventRepo?: RepoUtils<E>;

    private async getShareLinkRepo(): Promise<RepoUtils<L>> {
        if (!this.shareLinkRepo) {
            this.shareLinkRepo = await this._objectFactory!.newInstance(RepoUtils, {
                name: this.shareLinkClass.name,
                args: [this.shareLinkClass],
            });
        }
        return this.shareLinkRepo;
    }

    private async getCalendarEventRepo(): Promise<RepoUtils<E>> {
        if (!this.calendarEventRepo) {
            this.calendarEventRepo = await this._objectFactory!.newInstance(RepoUtils, {
                name: this.calendarEventClass.name,
                args: [this.calendarEventClass],
            });
        }
        return this.calendarEventRepo;
    }

    @Summary("Resolve a calendar share link")
    @Description(
        "Anonymous, unauthenticated lookup of a CalendarShareLink token - returns free/busy periods or full " +
            "calendar events for the shared folder, depending on the link's permittedActions. Responds 404 for " +
            "any invalid, unknown, or expired token, without distinguishing which, so a token's mere existence " +
            "can't be probed for.",
    )
    @Get("/:token")
    public async resolve(@Param("token") token: string, @Query("view") view?: string): Promise<FreeBusyPeriod[] | E[]> {
        const shareLinkRepo: RepoUtils<L> = await this.getShareLinkRepo();
        const matches: L[] = await shareLinkRepo.find({ token } as any, { ignoreACL: true, limit: 1 });
        const link: L | undefined = matches[0];

        // A nonexistent token and an expired one both respond 404 identically - distinguishing them (e.g. 410
        // Gone for "expired") would let a caller confirm a token existed/was once valid, which this link's
        // bearer-style, non-ACL-checked design is meant to avoid leaking.
        if (!link || (link.expiresAt && link.expiresAt.getTime() <= Date.now())) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }

        // "read" is the broader capability and always implies "freebusy" (whoever can see full event details
        // can certainly see just busy/free times) - `permittedActions` doesn't need to list both explicitly.
        const canRead: boolean = link.permittedActions.includes("read");
        const canFreeBusy: boolean = canRead || link.permittedActions.includes("freebusy");
        if (!canFreeBusy) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        // An explicit `?view=` is always honored exactly as requested (rejected with 403 if not permitted) -
        // never silently substituted for a different view the caller didn't ask for. Only the *default* (no
        // `?view=` given) picks the broadest view the link grants.
        const effectiveView: "read" | "freebusy" =
            view === "read" || view === "freebusy" ? view : canRead ? "read" : "freebusy";
        if (effectiveView === "read" && !canRead) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        const calendarEventRepo: RepoUtils<E> = await this.getCalendarEventRepo();
        // Scoped strictly to this link's OWN folder - `link.folderUid` comes from the resolved token record
        // itself, never from client input, so a valid token for one calendar can never be used to read another.
        const events: E[] = await calendarEventRepo.find({ folderUid: link.folderUid } as any, { ignoreACL: true });

        if (effectiveView === "read") {
            return events;
        }
        return events
            .filter((event) => event.status !== CalendarEventStatus.CANCELLED && event.busyStatus !== BusyStatus.FREE)
            .map((event) => ({ start: event.startDate, end: event.endDate }));
    }
}
