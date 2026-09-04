///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { BackgroundService, ObjectFactory, RepoUtils } from "@rapidrest/service-core";
import { CalendarShareLink } from "../models/types.js";
const { Config, Init, Logger } = ObjectDecorators;

/**
 * Garbage-collects expired `CalendarShareLink` rows (anonymous external calendar-sharing links whose
 * `expiresAt` has passed).
 *
 * TODO: Per the architecture plan, an expired share link's corresponding `ACLRecord` (granted on the shared
 * folder's `AccessControlList`, keyed by `CalendarShareLink.token` as the `userOrRoleId`) should also be
 * removed via `ACLUtils`. That's deliberately out of scope here - there isn't yet a clear, established mapping
 * from `CalendarShareLink.token` back to the exact `ACLRecord` to remove, and guessing at `ACLUtils`'s call
 * shape for that would risk removing the wrong grant. This job is scoped to deleting the expired
 * `CalendarShareLink` row itself; ACL cleanup is a follow-up once that mapping is established.
 *
 * Concrete entity classes are supplied by the Mongo/SQL subclasses (`ExternalShareExpirationJobMongo`/
 * `ExternalShareExpirationJobSQL`), following the same generic pattern `ScanQueueJob` uses.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class ExternalShareExpirationJob<S extends CalendarShareLink> extends BackgroundService {
    protected abstract calendarShareLinkClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private calendarShareLinkRepo?: RepoUtils<S>;

    @Config("mail:jobs:external_share_expiration:schedule", "0 0 5 * * *")
    private scheduleExpr: string = "0 0 5 * * *";

    @Config("mail:jobs:external_share_expiration:batch_size", 500)
    private batchSize: number = 500;

    @Logger
    private logger: any;

    public get schedule(): string | undefined {
        return this.scheduleExpr;
    }

    @Init
    public async init(): Promise<void> {
        this.calendarShareLinkRepo = await this._objectFactory!.newInstance(RepoUtils, {
            name: this.calendarShareLinkClass.name,
            args: [this.calendarShareLinkClass],
        });
    }

    public async start(): Promise<void> {
        // Nothing to do at startup beyond `init()` above; processing happens entirely in `run()`.
    }

    public stop(): Promise<void> | void {
        // Do nothing
    }

    public async run(): Promise<void> {
        if (!this.calendarShareLinkRepo) {
            return;
        }

        const now: Date = new Date();

        // Expiry can't be reliably pushed into the shared `find()` query DSL across both backends, so this
        // fetches a batch and filters in-process, same as this job's siblings.
        const links: S[] = await this.calendarShareLinkRepo.find({}, { ignoreACL: true, limit: this.batchSize });

        for (const link of links) {
            try {
                if (link.expiresAt && link.expiresAt < now) {
                    await this.calendarShareLinkRepo.delete(link.uid, { ignoreACL: true, purge: true });
                }
            } catch (err: any) {
                this.logger?.warn(`ExternalShareExpirationJob: failed to delete expired share link ${link.uid}: ${err.message}`);
            }
        }
    }
}
