///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// These tests prove BaseMapiEmsmdbRoute's transport plumbing (JWT auth, mailbox resolution, session-cookie
// establishment/teardown, the Execute envelope + RopBuffer framing round trip) AND the RopLogon/RopRelease/
// RopOpenFolder/RopGetHierarchyTable/RopGetContentsTable/RopSetColumns/RopQueryRows ROPs' real behavior, all
// over a real HTTP round trip - see the architecture plan's "Phase 3" section, build-order steps 3-6.
//
// Uses `mapiTestClient.ts`'s raw-socket `mapiRequest()` instead of the shared `@rapidrest/service-core/test`
// `request()` helper - see that file's doc comment for why (the shared helper's axios `responseType: "text"`
// reading corrupts binary response bytes >= 0x80, which MAPI/HTTP's raw integers routinely contain).
import config from "../../config.js";
import { MongoConnection, MongoRepository, Server, ObjectFactory, ConnectionManager, ACLAction } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { MailboxMongo } from "../../../src/models/mongo/MailboxMongo.js";
import { FolderMongo } from "../../../src/models/mongo/FolderMongo.js";
import { MessageMongo } from "../../../src/models/mongo/MessageMongo.js";
import { FolderType, MessageImportance, RecipientType } from "../../../src/models/types.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { registerTestDoubles } from "../../testDoubles.js";
import { cookieHeaderFrom, mapiRequest } from "../../mapi/mapiTestClient.js";
import { BufferReader, BufferWriter } from "../../../src/mapi/codec/BufferCursor.js";
import { decodeGuid } from "../../../src/mapi/codec/MapiGuid.js";
import { PropertyType, readPropertyValue, writePropertyTag } from "../../../src/mapi/codec/PropertyValue.js";
import { decodeRopBuffer, encodeRopBuffer } from "../../../src/mapi/codec/RopBuffer.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

describe("Route:MapiEmsmdbRouteMongo Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-mongo", logger, objectFactory });
    const baseUrl = "/mongo/mapi/emsmdb";
    let mailboxRepo: MongoRepository<MailboxMongo>;
    let folderRepo: MongoRepository<FolderMongo>;
    let messageRepo: MongoRepository<MessageMongo>;
    let aclRepo: MongoRepository<any>;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);

    const createMailbox = async function (ownerUid: string, data?: Partial<MailboxMongo>): Promise<MailboxMongo> {
        const obj: MailboxMongo = new MailboxMongo({
            ownerUserUid: ownerUid,
            primarySmtpAddress: `${uuid.v4()}@example.com`,
            aliasAddresses: [],
            displayName: "Test Mailbox",
            timezone: "UTC",
            quotaBytes: 1_000_000_000,
            usedBytes: 0,
            ...data,
        });
        const result: MailboxMongo = await mailboxRepo.save(obj);
        await aclRepo.save({
            uid: result.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records: [{ userOrRoleId: ownerUid, actions: [ACLAction.FULL] }],
            parentUid: "Mailbox",
        });
        return result;
    };

    const createFolder = async function (mailboxUid: string, type: FolderType, name: string, parentFolderUid?: string): Promise<FolderMongo> {
        return await folderRepo.save(
            new FolderMongo({ mailboxUid, name, type, parentFolderUid, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
        );
    };

    const createMessage = async function (mailboxUid: string, folderUid: string, data?: Partial<MessageMongo>): Promise<MessageMongo> {
        return await messageRepo.save(
            new MessageMongo({
                mailboxUid,
                folderUid,
                messageId: `${uuid.v4()}@example.com`,
                subject: "Test Subject",
                from: { address: "sender@example.com", displayName: "Sender", type: RecipientType.TO },
                recipients: [{ address: "owner@example.com", type: RecipientType.TO }],
                sentDate: new Date(),
                receivedDate: new Date("2026-03-15T09:00:00.000Z"),
                bodyBlobKey: `bodies/${uuid.v4()}`,
                bodyPreview: "Hello world",
                flags: { read: true, flagged: false, answered: false, forwarded: false },
                importance: MessageImportance.NORMAL,
                references: [],
                hasAttachments: false,
                ...data,
            }),
        );
    };

    const connect = async function (headers: Record<string, string> = {}) {
        return mapiRequest(
            server.getApplication(),
            baseUrl,
            {
                Authorization: "jwt " + ownerToken,
                "X-RequestType": "Connect",
                "Content-Type": "application/mapi-http",
                ...headers,
            },
            Buffer.alloc(0),
        );
    };

    const execute = async function (cookie: string, ropBuffer: Buffer) {
        const body = new BufferWriter();
        body.writeUInt32LE(0); // Flags
        body.writeUInt32LE(ropBuffer.length);
        body.writeBytes(ropBuffer);
        body.writeUInt32LE(256 * 1024); // MaxRopOut
        body.writeUInt32LE(0); // AuxiliaryBufferSize

        return mapiRequest(
            server.getApplication(),
            baseUrl,
            {
                Authorization: "jwt " + ownerToken,
                "X-RequestType": "Execute",
                "Content-Type": "application/mapi-http",
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body.toBuffer(),
        );
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
            messageRepo = conn.getMongoRepository("MessageMongo");
        } else {
            throw new Error("Could not find mongo connection");
        }
        const aclConn: any = connMgr?.connections.get("acl");
        if (aclConn instanceof MongoConnection) {
            aclRepo = aclConn.getMongoRepository("AccessControlListMongo");
        } else {
            throw new Error("Could not find mongo acl connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        for (const repo of [mailboxRepo, folderRepo, messageRepo, aclRepo]) {
            try {
                await repo.clear();
            } catch (err: any) {
                if (err.message !== "ns not found") {
                    throw err;
                }
            }
        }
    });

    describe("Connect", () => {
        it("Requires authentication.", async () => {
            const result = await mapiRequest(
                server.getApplication(),
                baseUrl,
                { "X-RequestType": "Connect", "Content-Type": "application/mapi-http" },
                Buffer.alloc(0),
            );
            expect(result.status).toBe(401);
        });

        it("Returns 404 when the caller owns no mailbox.", async () => {
            const result = await connect();
            expect(result.status).toBe(404);
        });

        it("Establishes a session, setting both MapiContext and MapiSequence cookies.", async () => {
            await createMailbox(owner.uid);
            const result = await connect();
            expect(result.status).toBe(200);
            const cookie = cookieHeaderFrom(result.headers["set-cookie"]);
            expect(cookie).toContain("MapiContext=");
            expect(cookie).toContain("MapiSequence=");
        });

        it("Returns a well-formed success response body (StatusCode/ErrorCode both zero) with the DisplayName echoed.", async () => {
            await createMailbox(owner.uid, { displayName: "Ada Lovelace" });
            const result = await connect();

            const reader = new BufferReader(result.body);
            expect(reader.readUInt32LE()).toBe(0); // StatusCode
            expect(reader.readUInt32LE()).toBe(0); // ErrorCode
            expect(reader.readUInt32LE()).toBe(60000); // PollsMax
            expect(reader.readUInt32LE()).toBe(3); // RetryCount
            expect(reader.readUInt32LE()).toBe(5000); // RetryDelay
            reader.readNullTerminatedString8(); // DnPrefix
            expect(reader.readNullTerminatedUtf16LE()).toBe("Ada Lovelace");
            expect(reader.readUInt32LE()).toBe(0); // AuxiliaryBufferSize
            expect(reader.hasMore()).toBe(false);
        });

        it("Sets the common MAPI/HTTP response headers.", async () => {
            await createMailbox(owner.uid);
            const result = await connect({ "X-RequestId": "req-123" });

            expect(result.headers["content-type"]).toContain("application/mapi-http");
            expect(result.headers["x-requesttype"]).toBe("Connect");
            expect(result.headers["x-requestid"]).toBe("req-123");
            expect(result.headers["x-responsecode"]).toBe("0");
        });
    });

    describe("Execute", () => {
        it("Returns a session-not-found error code when no MapiContext cookie is presented.", async () => {
            await createMailbox(owner.uid);
            const emptyRop = encodeRopBuffer({ ropsList: Buffer.alloc(0), handleTable: [] });
            const result = await execute("", emptyRop);

            expect(result.status).toBe(200);
            expect(result.headers["x-responsecode"]).not.toBe("0");
            const reader = new BufferReader(result.body);
            expect(reader.readUInt32LE()).toBe(0); // StatusCode
            expect(reader.readUInt32LE()).not.toBe(0); // ErrorCode
        });

        it("Echoes back an empty but well-formed ROP buffer, preserving the handle table, for a valid session.", async () => {
            await createMailbox(owner.uid);
            const connectResult = await connect();
            const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

            const inputRop = encodeRopBuffer({ ropsList: Buffer.alloc(0), handleTable: [7, 9] });
            const result = await execute(cookie, inputRop);

            expect(result.status).toBe(200);
            expect(result.headers["x-responsecode"]).toBe("0");
            const reader = new BufferReader(result.body);
            expect(reader.readUInt32LE()).toBe(0); // StatusCode
            expect(reader.readUInt32LE()).toBe(0); // ErrorCode
            reader.readUInt32LE(); // Flags
            const responseRopBufferSize = reader.readUInt32LE();
            const responseRopBuffer = reader.readBytes(responseRopBufferSize);
            // RopSize field (2 bytes) + empty ropsList = 2, then the two preserved handle-table entries.
            expect(responseRopBuffer.readUInt16LE(0)).toBe(2);
            expect(responseRopBuffer.readUInt32LE(2)).toBe(7);
            expect(responseRopBuffer.readUInt32LE(6)).toBe(9);
            expect(reader.readUInt32LE()).toBe(0); // AuxiliaryBufferSize
        });
    });

    describe("RopLogon / RopRelease", () => {
        const buildRopLogonRops = function (outputHandleIndex: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0xfe); // RopId
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0x01); // LogonFlags (Private)
            writer.writeUInt32LE(0); // OpenFlags
            writer.writeUInt32LE(0); // StoreState
            writer.writeUInt16LE(0); // EssdnSize
            return writer.toBuffer();
        };

        const buildRopReleaseRops = function (inputHandleIndex: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x01); // RopId
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            return writer.toBuffer();
        };

        it("Logs on to a real mailbox and returns 13 well-formed, distinct FIDs.", async () => {
            const mailbox = await createMailbox(owner.uid, { displayName: "Ada Lovelace" });
            const connectResult = await connect();
            const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

            const inputRop = encodeRopBuffer({ ropsList: buildRopLogonRops(0), handleTable: [0xffffffff] });
            const result = await execute(cookie, inputRop);

            expect(result.status).toBe(200);
            expect(result.headers["x-responsecode"]).toBe("0");
            const reader = new BufferReader(result.body);
            reader.readUInt32LE(); // StatusCode
            reader.readUInt32LE(); // ErrorCode
            reader.readUInt32LE(); // Flags
            const ropBufferSize = reader.readUInt32LE();
            const { ropsList, handleTable } = decodeRopBuffer(reader.readBytes(ropBufferSize));
            expect(handleTable).toEqual([0xffffffff]);

            const ropsReader = new BufferReader(ropsList);
            expect(ropsReader.readUInt8()).toBe(0xfe); // RopId
            expect(ropsReader.readUInt8()).toBe(0); // OutputHandleIndex
            expect(ropsReader.readUInt32LE()).toBe(0); // ReturnValue
            expect(ropsReader.readUInt8()).toBe(0x01); // LogonFlags, echoed

            const fids: bigint[] = [];
            for (let i = 0; i < 13; i++) {
                fids.push(ropsReader.readBigUInt64LE());
            }
            expect(new Set(fids).size).toBe(13); // all 13 FIDs are distinct

            ropsReader.readUInt8(); // ResponseFlags
            expect(decodeGuid(ropsReader)).toBe(mailbox.uid); // MailboxGuid
            expect(ropsReader.hasMore()).toBe(true); // ReplId/ReplGuid/LogonTime/GwartTime/StoreState follow
            // The FID<->Folder mapping itself (Inbox/Outbox/Sent/Deleted resolving to a real Folder when one
            // exists) is verified directly against session.folderIds in RopLogonHandler's own unit tests
            // (test/mapi/rop/RopLogonHandler.test.ts) - not observable from outside this black-box HTTP test,
            // since FIDs are opaque numbers to the client until a later RopOpenFolder (a future build step).
        });

        it("Releases a logon handle with no response bytes for that ROP, matching the spec's own captured example.", async () => {
            await createMailbox(owner.uid);
            const connectResult = await connect();
            const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

            const logonRop = encodeRopBuffer({ ropsList: buildRopLogonRops(0), handleTable: [0xffffffff] });
            await execute(cookie, logonRop);

            const releaseRop = encodeRopBuffer({ ropsList: buildRopReleaseRops(0), handleTable: [0] });
            const result = await execute(cookie, releaseRop);

            expect(result.headers["x-responsecode"]).toBe("0");
            const reader = new BufferReader(result.body);
            reader.readUInt32LE(); // StatusCode
            reader.readUInt32LE(); // ErrorCode
            reader.readUInt32LE(); // Flags
            const ropBufferSize = reader.readUInt32LE();
            const { ropsList } = decodeRopBuffer(reader.readBytes(ropBufferSize));
            // RopRelease produces no response entry - the entire ropsList is empty.
            expect(ropsList.length).toBe(0);
        });
    });

    describe("Folder hierarchy browsing (RopOpenFolder / RopGetHierarchyTable / RopSetColumns / RopQueryRows)", () => {
        const buildLogonRops = function (outputHandleIndex: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0xfe);
            writer.writeUInt8(0);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0x01);
            writer.writeUInt32LE(0);
            writer.writeUInt32LE(0);
            writer.writeUInt16LE(0);
            return writer.toBuffer();
        };

        const buildOpenFolderRops = function (inputHandleIndex: number, outputHandleIndex: number, folderId: bigint): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x02);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0); // OpenModeFlags
            writer.writeBigUInt64LE(folderId);
            return writer.toBuffer();
        };

        const buildGetHierarchyTableRops = function (inputHandleIndex: number, outputHandleIndex: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x04);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0); // TableFlags - Standard
            return writer.toBuffer();
        };

        const buildSetColumnsRops = function (inputHandleIndex: number, tags: { propertyId: number; propertyType: PropertyType }[]): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x12);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(0); // SetColumnsFlags
            writer.writeUInt16LE(tags.length);
            for (const tag of tags) {
                writePropertyTag(writer, tag);
            }
            return writer.toBuffer();
        };

        const buildQueryRowsRops = function (inputHandleIndex: number, rowCount: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x15);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(0); // QueryRowsFlags
            writer.writeUInt8(1); // ForwardRead
            writer.writeUInt16LE(rowCount);
            return writer.toBuffer();
        };

        it("Browses the top-level folder list end to end: Logon, OpenFolder(root), GetHierarchyTable, SetColumns, QueryRows.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await createFolder(mailbox.uid, FolderType.INBOX, "Inbox");
            await createFolder(mailbox.uid, FolderType.USER, "Archive");
            const connectResult = await connect();
            const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

            // Logon (handle 0) - discover the "root" FID.
            const logonInput = encodeRopBuffer({ ropsList: buildLogonRops(0), handleTable: [0xffffffff] });
            const logonResult = await execute(cookie, logonInput);
            const logonReader = new BufferReader(logonResult.body);
            logonReader.readUInt32LE();
            logonReader.readUInt32LE();
            logonReader.readUInt32LE();
            const logonRopBufferSize = logonReader.readUInt32LE();
            const { ropsList: logonRopsList } = decodeRopBuffer(logonReader.readBytes(logonRopBufferSize));
            const logonRopsReader = new BufferReader(logonRopsList);
            logonRopsReader.readUInt8(); // RopId
            logonRopsReader.readUInt8(); // OutputHandleIndex
            logonRopsReader.readUInt32LE(); // ReturnValue
            logonRopsReader.readUInt8(); // LogonFlags
            const rootFid = logonRopsReader.readBigUInt64LE(); // FolderIds[0] = Root

            // OpenFolder(root) at handle 1, using logon handle 0 as input.
            const openFolderInput = encodeRopBuffer({ ropsList: buildOpenFolderRops(0, 1, rootFid), handleTable: [0xffffffff, 0xffffffff] });
            const openFolderResult = await execute(cookie, openFolderInput);
            const openFolderReader = new BufferReader(openFolderResult.body);
            openFolderReader.readUInt32LE();
            openFolderReader.readUInt32LE();
            openFolderReader.readUInt32LE();
            const openFolderRopBufferSize = openFolderReader.readUInt32LE();
            const { ropsList: openFolderRopsList } = decodeRopBuffer(openFolderReader.readBytes(openFolderRopBufferSize));
            const openFolderRopsReader = new BufferReader(openFolderRopsList);
            openFolderRopsReader.readUInt8();
            openFolderRopsReader.readUInt8();
            expect(openFolderRopsReader.readUInt32LE()).toBe(0); // ReturnValue - success

            // GetHierarchyTable at handle 2, using folder handle 1 as input.
            const tableInput = encodeRopBuffer({ ropsList: buildGetHierarchyTableRops(1, 2), handleTable: [0xffffffff, 0xffffffff, 0xffffffff] });
            const tableResult = await execute(cookie, tableInput);
            const tableReader = new BufferReader(tableResult.body);
            tableReader.readUInt32LE();
            tableReader.readUInt32LE();
            tableReader.readUInt32LE();
            const tableRopBufferSize = tableReader.readUInt32LE();
            const { ropsList: tableRopsList } = decodeRopBuffer(tableReader.readBytes(tableRopBufferSize));
            const tableRopsReader = new BufferReader(tableRopsList);
            tableRopsReader.readUInt8();
            tableRopsReader.readUInt8();
            expect(tableRopsReader.readUInt32LE()).toBe(0); // ReturnValue - success

            // SetColumns on table handle 2: DisplayName + ContentCount + ContentUnreadCount.
            const columns = [
                { propertyId: 0x3001, propertyType: PropertyType.PtypString },
                { propertyId: 0x3602, propertyType: PropertyType.PtypInteger32 },
                { propertyId: 0x3603, propertyType: PropertyType.PtypInteger32 },
            ];
            const setColumnsInput = encodeRopBuffer({ ropsList: buildSetColumnsRops(2, columns), handleTable: [0xffffffff] });
            const setColumnsResult = await execute(cookie, setColumnsInput);
            expect(setColumnsResult.headers["x-responsecode"]).toBe("0");

            // QueryRows on table handle 2.
            const queryRowsInput = encodeRopBuffer({ ropsList: buildQueryRowsRops(2, 10), handleTable: [0xffffffff] });
            const queryRowsResult = await execute(cookie, queryRowsInput);
            const queryRowsReader = new BufferReader(queryRowsResult.body);
            queryRowsReader.readUInt32LE();
            queryRowsReader.readUInt32LE();
            queryRowsReader.readUInt32LE();
            const queryRowsBufferSize = queryRowsReader.readUInt32LE();
            const { ropsList: queryRowsList } = decodeRopBuffer(queryRowsReader.readBytes(queryRowsBufferSize));
            const rowsReader = new BufferReader(queryRowsList);
            rowsReader.readUInt8(); // RopId
            rowsReader.readUInt8(); // InputHandleIndex
            expect(rowsReader.readUInt32LE()).toBe(0); // ReturnValue
            rowsReader.readUInt8(); // Origin
            const rowCount = rowsReader.readUInt16LE();
            expect(rowCount).toBe(2);

            const names: string[] = [];
            for (let i = 0; i < rowCount; i++) {
                rowsReader.readUInt8(); // PropertyRow Flags
                names.push(readPropertyValue(rowsReader, PropertyType.PtypString) as string);
                readPropertyValue(rowsReader, PropertyType.PtypInteger32); // ContentCount
                readPropertyValue(rowsReader, PropertyType.PtypInteger32); // ContentUnreadCount
            }
            expect(names.sort()).toEqual(["Archive", "Inbox"]);
            expect(rowsReader.hasMore()).toBe(false);
        });
    });

    describe("Message listing (RopGetContentsTable / RopSetColumns / RopQueryRows)", () => {
        const buildLogonRops = function (outputHandleIndex: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0xfe);
            writer.writeUInt8(0);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0x01);
            writer.writeUInt32LE(0);
            writer.writeUInt32LE(0);
            writer.writeUInt16LE(0);
            return writer.toBuffer();
        };

        const buildOpenFolderRops = function (inputHandleIndex: number, outputHandleIndex: number, folderId: bigint): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x02);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0); // OpenModeFlags
            writer.writeBigUInt64LE(folderId);
            return writer.toBuffer();
        };

        const buildGetContentsTableRops = function (inputHandleIndex: number, outputHandleIndex: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x05);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt8(0); // TableFlags - Standard
            return writer.toBuffer();
        };

        const buildSetColumnsRops = function (inputHandleIndex: number, tags: { propertyId: number; propertyType: PropertyType }[]): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x12);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(0); // SetColumnsFlags
            writer.writeUInt16LE(tags.length);
            for (const tag of tags) {
                writePropertyTag(writer, tag);
            }
            return writer.toBuffer();
        };

        const buildQueryRowsRops = function (inputHandleIndex: number, rowCount: number): Buffer {
            const writer = new BufferWriter();
            writer.writeUInt8(0x15);
            writer.writeUInt8(0); // LogonId
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt8(0); // QueryRowsFlags
            writer.writeUInt8(1); // ForwardRead
            writer.writeUInt16LE(rowCount);
            return writer.toBuffer();
        };

        it("Lists a folder's messages end to end: Logon, OpenFolder(inbox), GetContentsTable, SetColumns, QueryRows.", async () => {
            const mailbox = await createMailbox(owner.uid);
            const inbox = await createFolder(mailbox.uid, FolderType.INBOX, "Inbox");
            await createMessage(mailbox.uid, inbox.uid, { subject: "Hello World" });
            await createMessage(mailbox.uid, inbox.uid, { subject: "Second Message" });
            const connectResult = await connect();
            const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

            // Logon (handle 0) - discover the Inbox FID.
            const logonInput = encodeRopBuffer({ ropsList: buildLogonRops(0), handleTable: [0xffffffff] });
            const logonResult = await execute(cookie, logonInput);
            const logonReader = new BufferReader(logonResult.body);
            logonReader.readUInt32LE();
            logonReader.readUInt32LE();
            logonReader.readUInt32LE();
            const logonRopBufferSize = logonReader.readUInt32LE();
            const { ropsList: logonRopsList } = decodeRopBuffer(logonReader.readBytes(logonRopBufferSize));
            const logonRopsReader = new BufferReader(logonRopsList);
            logonRopsReader.readUInt8(); // RopId
            logonRopsReader.readUInt8(); // OutputHandleIndex
            logonRopsReader.readUInt32LE(); // ReturnValue
            logonRopsReader.readUInt8(); // LogonFlags
            logonRopsReader.readBigUInt64LE(); // FolderIds[0] = Root
            logonRopsReader.readBigUInt64LE(); // FolderIds[1] = Deferred Action
            logonRopsReader.readBigUInt64LE(); // FolderIds[2] = Spooler Queue
            logonRopsReader.readBigUInt64LE(); // FolderIds[3] = IPM Subtree
            const inboxFid = logonRopsReader.readBigUInt64LE(); // FolderIds[4] = Inbox

            // OpenFolder(inbox) at handle 1, using logon handle 0 as input.
            const openFolderInput = encodeRopBuffer({ ropsList: buildOpenFolderRops(0, 1, inboxFid), handleTable: [0xffffffff, 0xffffffff] });
            const openFolderResult = await execute(cookie, openFolderInput);
            const openFolderReader = new BufferReader(openFolderResult.body);
            openFolderReader.readUInt32LE();
            openFolderReader.readUInt32LE();
            openFolderReader.readUInt32LE();
            const openFolderRopBufferSize = openFolderReader.readUInt32LE();
            const { ropsList: openFolderRopsList } = decodeRopBuffer(openFolderReader.readBytes(openFolderRopBufferSize));
            const openFolderRopsReader = new BufferReader(openFolderRopsList);
            openFolderRopsReader.readUInt8();
            openFolderRopsReader.readUInt8();
            expect(openFolderRopsReader.readUInt32LE()).toBe(0); // ReturnValue - success

            // GetContentsTable at handle 2, using folder handle 1 as input.
            const tableInput = encodeRopBuffer({ ropsList: buildGetContentsTableRops(1, 2), handleTable: [0xffffffff, 0xffffffff, 0xffffffff] });
            const tableResult = await execute(cookie, tableInput);
            const tableReader = new BufferReader(tableResult.body);
            tableReader.readUInt32LE();
            tableReader.readUInt32LE();
            tableReader.readUInt32LE();
            const tableRopBufferSize = tableReader.readUInt32LE();
            const { ropsList: tableRopsList } = decodeRopBuffer(tableReader.readBytes(tableRopBufferSize));
            const tableRopsReader = new BufferReader(tableRopsList);
            tableRopsReader.readUInt8();
            tableRopsReader.readUInt8();
            expect(tableRopsReader.readUInt32LE()).toBe(0); // ReturnValue - success

            // SetColumns on table handle 2: Subject.
            const columns = [{ propertyId: 0x0037, propertyType: PropertyType.PtypString }];
            const setColumnsInput = encodeRopBuffer({ ropsList: buildSetColumnsRops(2, columns), handleTable: [0xffffffff] });
            const setColumnsResult = await execute(cookie, setColumnsInput);
            expect(setColumnsResult.headers["x-responsecode"]).toBe("0");

            // QueryRows on table handle 2.
            const queryRowsInput = encodeRopBuffer({ ropsList: buildQueryRowsRops(2, 10), handleTable: [0xffffffff] });
            const queryRowsResult = await execute(cookie, queryRowsInput);
            const queryRowsReader = new BufferReader(queryRowsResult.body);
            queryRowsReader.readUInt32LE();
            queryRowsReader.readUInt32LE();
            queryRowsReader.readUInt32LE();
            const queryRowsBufferSize = queryRowsReader.readUInt32LE();
            const { ropsList: queryRowsList } = decodeRopBuffer(queryRowsReader.readBytes(queryRowsBufferSize));
            const rowsReader = new BufferReader(queryRowsList);
            rowsReader.readUInt8(); // RopId
            rowsReader.readUInt8(); // InputHandleIndex
            expect(rowsReader.readUInt32LE()).toBe(0); // ReturnValue
            rowsReader.readUInt8(); // Origin
            const rowCount = rowsReader.readUInt16LE();
            expect(rowCount).toBe(2);

            const subjects: string[] = [];
            for (let i = 0; i < rowCount; i++) {
                rowsReader.readUInt8(); // PropertyRow Flags
                subjects.push(readPropertyValue(rowsReader, PropertyType.PtypString) as string);
            }
            expect(subjects.sort()).toEqual(["Hello World", "Second Message"]);
            expect(rowsReader.hasMore()).toBe(false);
        });
    });

    describe("Disconnect", () => {
        it("Releases the session such that a subsequent Execute reports session-not-found.", async () => {
            await createMailbox(owner.uid);
            const connectResult = await connect();
            const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

            const disconnectResult = await mapiRequest(
                server.getApplication(),
                baseUrl,
                {
                    Authorization: "jwt " + ownerToken,
                    "X-RequestType": "Disconnect",
                    "Content-Type": "application/mapi-http",
                    Cookie: cookie,
                },
                Buffer.alloc(0),
            );
            expect(disconnectResult.status).toBe(200);

            const emptyRop = encodeRopBuffer({ ropsList: Buffer.alloc(0), handleTable: [] });
            const executeResult = await execute(cookie, emptyRop);
            expect(executeResult.headers["x-responsecode"]).not.toBe("0");
        });
    });

    describe("Unrecognized/deferred request types", () => {
        it("Returns 400 for a missing/unrecognized X-RequestType.", async () => {
            const result = await mapiRequest(
                server.getApplication(),
                baseUrl,
                { Authorization: "jwt " + ownerToken, "Content-Type": "application/mapi-http" },
                Buffer.alloc(0),
            );
            expect(result.status).toBe(400);
        });

        it("Returns 501 for the recognized-but-deferred NotificationWait request type.", async () => {
            const result = await mapiRequest(
                server.getApplication(),
                baseUrl,
                {
                    Authorization: "jwt " + ownerToken,
                    "X-RequestType": "NotificationWait",
                    "Content-Type": "application/mapi-http",
                },
                Buffer.alloc(0),
            );
            expect(result.status).toBe(501);
        });
    });
});
