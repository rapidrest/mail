///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import config from "../../config.js";
import { request } from "@rapidrest/service-core/test";
import { MongoConnection, MongoRepository, Server, ObjectFactory, ConnectionManager } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { MailboxMongo } from "../../../src/models/mongo/MailboxMongo.js";
import { FolderMongo } from "../../../src/models/mongo/FolderMongo.js";
import { CalendarEventMongo } from "../../../src/models/mongo/CalendarEventMongo.js";
import { CalendarShareLinkMongo } from "../../../src/models/mongo/CalendarShareLinkMongo.js";
import { BusyStatus, CalendarEventStatus, FolderType, RecipientType } from "../../../src/models/types.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { registerTestDoubles } from "../../testDoubles.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

describe("Route:CalendarFreeBusyMongo Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-mongo", logger, objectFactory });
    const baseUrl = "/mongo/calendar-freebusy";
    let mailboxRepo: MongoRepository<MailboxMongo>;
    let folderRepo: MongoRepository<FolderMongo>;
    let calendarEventRepo: MongoRepository<CalendarEventMongo>;
    let shareLinkRepo: MongoRepository<CalendarShareLinkMongo>;

    const owner: any = { uid: uuid.v4() };

    const createMailbox = async function (): Promise<MailboxMongo> {
        const obj: MailboxMongo = new MailboxMongo({
            ownerUserUid: owner.uid,
            primarySmtpAddress: `${uuid.v4()}@example.com`,
            aliasAddresses: [],
            displayName: "Test Mailbox",
            timezone: "UTC",
            quotaBytes: 1_000_000_000,
            usedBytes: 0,
        });
        return await mailboxRepo.save(obj);
    };

    const createFolder = async function (mailboxUid: string): Promise<FolderMongo> {
        const obj: FolderMongo = new FolderMongo({
            mailboxUid,
            name: "Calendar",
            type: FolderType.CALENDAR,
            unreadCount: 0,
            totalCount: 0,
            syncKeyVersion: 0,
        });
        return await folderRepo.save(obj);
    };

    const createCalendarEvent = async function (
        mailboxUid: string,
        folderUid: string,
        data?: any,
    ): Promise<CalendarEventMongo> {
        const now = new Date();
        const obj: CalendarEventMongo = new CalendarEventMongo({
            mailboxUid,
            folderUid,
            title: "Team Sync",
            startDate: now,
            endDate: new Date(now.getTime() + 60 * 60 * 1000),
            allDay: false,
            timezone: "UTC",
            organizer: { address: "organizer@example.com", type: RecipientType.TO },
            attendees: [],
            status: CalendarEventStatus.CONFIRMED,
            busyStatus: BusyStatus.BUSY,
            icalUid: uuid.v4(),
            sequence: 0,
            ...data,
        });
        return await calendarEventRepo.save(obj);
    };

    const createShareLink = async function (folderUid: string, data?: any): Promise<CalendarShareLinkMongo> {
        const obj: CalendarShareLinkMongo = new CalendarShareLinkMongo({
            token: uuid.v4(),
            folderUid,
            permittedActions: ["freebusy"],
            createdByUserUid: owner.uid,
            ...data,
        });
        return await shareLinkRepo.save(obj);
    };

    beforeAll(async () => {
        await mongod.start();
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("mongo");
        if (conn instanceof MongoConnection) {
            mailboxRepo = conn.getMongoRepository("MailboxMongo");
            folderRepo = conn.getMongoRepository("FolderMongo");
            calendarEventRepo = conn.getMongoRepository("CalendarEventMongo");
            shareLinkRepo = conn.getMongoRepository("CalendarShareLinkMongo");
        } else {
            throw new Error("Could not find mongo connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        for (const repo of [mailboxRepo, folderRepo, calendarEventRepo, shareLinkRepo]) {
            try {
                await repo.clear();
            } catch (err: any) {
                if (err.message !== "ns not found") {
                    throw err;
                }
            }
        }
    });

    it("Requires no authentication at all (anonymous access).", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid);

        // Deliberately no Authorization header set.
        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(200);
    });

    it("Returns only {start, end} busy periods for a freebusy-permitted link, with no title/location/attendees leaked.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: ["freebusy"] });
        const event = await createCalendarEvent(mailbox.uid, folder.uid, { title: "Secret Meeting", location: "Room 42" });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(200);
        expect(result.body).toEqual([
            { start: event.startDate.toISOString(), end: event.endDate.toISOString() },
        ]);
        expect(JSON.stringify(result.body)).not.toContain("Secret Meeting");
        expect(JSON.stringify(result.body)).not.toContain("Room 42");
    });

    it("Excludes FREE and CANCELLED events from the freebusy view.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: ["freebusy"] });
        await createCalendarEvent(mailbox.uid, folder.uid, { busyStatus: BusyStatus.FREE });
        await createCalendarEvent(mailbox.uid, folder.uid, { status: CalendarEventStatus.CANCELLED });
        const busyEvent = await createCalendarEvent(mailbox.uid, folder.uid, { busyStatus: BusyStatus.BUSY });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(200);
        expect(result.body.length).toBe(1);
        expect(result.body[0].start).toBe(busyEvent.startDate.toISOString());
    });

    it("Returns full event details for a read-permitted link.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: ["read"] });
        const event = await createCalendarEvent(mailbox.uid, folder.uid, { title: "Visible Meeting" });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(200);
        expect(result.body.length).toBe(1);
        expect(result.body[0].uid).toBe(event.uid);
        expect(result.body[0].title).toBe("Visible Meeting");
    });

    it("Honors an explicit ?view=freebusy override even when the link grants full read access.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: ["read"] });
        await createCalendarEvent(mailbox.uid, folder.uid, { title: "Should Be Hidden" });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}?view=freebusy`);

        expect(result.status).toBe(200);
        expect(JSON.stringify(result.body)).not.toContain("Should Be Hidden");
        expect(result.body[0]).not.toHaveProperty("title");
    });

    it("Returns 403 when a freebusy-only link is asked for the read view.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: ["freebusy"] });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}?view=read`);

        expect(result.status).toBe(403);
    });

    it("Returns 404 for an unknown token.", async () => {
        const result = await request(server.getApplication()).get(`${baseUrl}/${uuid.v4()}`);
        expect(result.status).toBe(404);
    });

    it("Returns 404 (not a distinguishable error) for an expired token.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { expiresAt: new Date(Date.now() - 1000) });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(404);
    });

    it("A non-expired link (expiresAt in the future) still works.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { expiresAt: new Date(Date.now() + 100000) });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(200);
    });

    it("A valid token for one calendar can never be used to read a different folder's events (strict folderUid scoping).", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const otherFolder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: ["read"] });
        await createCalendarEvent(mailbox.uid, folder.uid, { title: "In Shared Calendar" });
        await createCalendarEvent(mailbox.uid, otherFolder.uid, { title: "In Other Calendar" });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(200);
        expect(result.body.length).toBe(1);
        expect(result.body[0].title).toBe("In Shared Calendar");
    });

    it("Returns 403 for a link with an empty permittedActions list.", async () => {
        const mailbox = await createMailbox();
        const folder = await createFolder(mailbox.uid);
        const link = await createShareLink(folder.uid, { permittedActions: [] });

        const result = await request(server.getApplication()).get(`${baseUrl}/${link.token}`);

        expect(result.status).toBe(403);
    });
});
