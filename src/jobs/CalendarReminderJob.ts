///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { BackgroundService, NotificationUtils, ObjectFactory, RepoUtils } from "@rapidrest/service-core";
import { CalendarEvent } from "../models/types.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

/**
 * Polls upcoming `CalendarEvent` records and dispatches a `"reminder"` push notification once each event's
 * configured `reminderMinutesBeforeStart` fire time falls within this job's own polling window.
 *
 * `CalendarEvent` has no persisted "reminder already sent" flag, and adding one is out of scope here, so this
 * job takes the simplest correct-enough approach: fetch a batch of candidate events (up to 24 hours out) and
 * compute/filter everything in-process rather than pushing the reminder-time arithmetic (or even the `startDate`
 * range itself) into the query - the shared `find()` query DSL is not guaranteed to translate range comparisons
 * identically across the Mongo and SQL backends, so filtering happens entirely here instead.
 *
 * KNOWN LIMITATION: without a persisted "reminder already sent" flag (e.g. a future `CalendarEvent.
 * reminderSentAt`), a reminder could in principle fire more than once if this job's own polling window ever
 * overlaps across runs (e.g. after a restart, or a run that took longer than `windowSeconds`). This is a
 * deliberate simplification, not an oversight - flagged here for a future follow-up.
 *
 * Concrete entity classes are supplied by the Mongo/SQL subclasses (`CalendarReminderJobMongo`/
 * `CalendarReminderJobSQL`), following the same generic pattern `ScanQueueJob` uses.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class CalendarReminderJob<CE extends CalendarEvent> extends BackgroundService {
    protected abstract calendarEventClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private calendarEventRepo?: RepoUtils<CE>;

    @Inject(NotificationUtils)
    private notificationUtils?: NotificationUtils;

    @Config("mail:jobs:calendar_reminder:schedule", "0 * * * * *")
    private scheduleExpr: string = "0 * * * * *";

    @Config("mail:jobs:calendar_reminder:batch_size", 200)
    private batchSize: number = 200;

    @Config("mail:jobs:calendar_reminder:window_seconds", 60)
    private windowSeconds: number = 60;

    @Logger
    private logger: any;

    public get schedule(): string | undefined {
        return this.scheduleExpr;
    }

    @Init
    public async init(): Promise<void> {
        this.calendarEventRepo = await this._objectFactory!.newInstance(RepoUtils, {
            name: this.calendarEventClass.name,
            args: [this.calendarEventClass],
        });
    }

    public async start(): Promise<void> {
        // Nothing to do at startup beyond `init()` above; processing happens entirely in `run()`.
    }

    public stop(): Promise<void> | void {
        // Do nothing
    }

    public async run(): Promise<void> {
        if (!this.calendarEventRepo) {
            return;
        }

        const now: Date = new Date();
        const windowEnd: Date = new Date(now.getTime() + this.windowSeconds * 1000);
        // A generous upper bound (24 hours) on candidates fetched per run - actual eligibility is decided below
        // by comparing each candidate's computed reminder fire time against [now, windowEnd].
        const lookaheadEnd: Date = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const candidates: CE[] = await this.calendarEventRepo.find({}, { ignoreACL: true, limit: this.batchSize });

        for (const event of candidates) {
            try {
                if (event.reminderMinutesBeforeStart === undefined || event.reminderMinutesBeforeStart === null) {
                    continue;
                }
                if (event.startDate < now || event.startDate > lookaheadEnd) {
                    continue;
                }

                const fireAt: Date = new Date(event.startDate.getTime() - event.reminderMinutesBeforeStart * 60 * 1000);
                if (fireAt >= now && fireAt <= windowEnd) {
                    this.notificationUtils?.sendMessage([event.folderUid, event.mailboxUid], "CalendarEvent", "reminder", {
                        eventUid: event.uid,
                        title: event.title,
                        startDate: event.startDate,
                    });
                }
            } catch (err: any) {
                this.logger?.warn(`CalendarReminderJob: failed to process reminder for event ${event.uid}: ${err.message}`);
            }
        }
    }
}
