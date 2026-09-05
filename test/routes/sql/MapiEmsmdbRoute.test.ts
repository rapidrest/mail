///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// See the identical file header in test/routes/mongo/MapiEmsmdbRoute.test.ts for the full rationale - this
// verifies the same BaseMapiEmsmdbRoute transport plumbing on the SQL-backed variant.
import config from "../../config.sql.js";
import { Server, ObjectFactory, ConnectionManager, isSqlDataSource, ACLAction, AccessControlListSQL } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { Repository } from "typeorm";
import { MailboxSQL } from "../../../src/models/sql/MailboxSQL.js";
import { FolderSQL } from "../../../src/models/sql/FolderSQL.js";
import { MessageSQL } from "../../../src/models/sql/MessageSQL.js";
import { FolderType, MessageImportance, RecipientType } from "../../../src/models/types.js";
import { registerTestDoubles } from "../../testDoubles.js";
import { cookieHeaderFrom, mapiRequest } from "../../mapi/mapiTestClient.js";
import { BufferReader, BufferWriter } from "../../../src/mapi/codec/BufferCursor.js";
import { decodeGuid } from "../../../src/mapi/codec/MapiGuid.js";
import { PropertyType, readPropertyValue, writePropertyTag } from "../../../src/mapi/codec/PropertyValue.js";
import { decodeRopBuffer, encodeRopBuffer } from "../../../src/mapi/codec/RopBuffer.js";

describe("Route:MapiEmsmdbRouteSQL Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-sql", logger, objectFactory });
    const baseUrl = "/sql/mapi/emsmdb";
    let mailboxRepo: Repository<MailboxSQL>;
    let folderRepo: Repository<FolderSQL>;
    let messageRepo: Repository<MessageSQL>;
    let aclRepo: Repository<AccessControlListSQL>;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);

    const createMailbox = async function (ownerUid: string, data?: Partial<MailboxSQL>): Promise<MailboxSQL> {
        const obj: MailboxSQL = new MailboxSQL({
            ownerUserUid: ownerUid,
            primarySmtpAddress: `${uuid.v4()}@example.com`,
            aliasAddresses: [],
            displayName: "Test Mailbox",
            timezone: "UTC",
            quotaBytes: 1_000_000_000,
            usedBytes: 0,
            ...data,
        });
        const result: MailboxSQL = await mailboxRepo.save(obj);
        await aclRepo.save({
            uid: result.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records: [{ userOrRoleId: ownerUid, actions: [ACLAction.FULL] }],
            parentUid: "Mailbox",
        } as any);
        return result;
    };

    const createFolder = async function (mailboxUid: string, type: FolderType, name: string): Promise<FolderSQL> {
        return await folderRepo.save(
            new FolderSQL({ mailboxUid, name, type, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 } as any),
        );
    };

    const createMessage = async function (mailboxUid: string, folderUid: string, data?: Partial<MessageSQL>): Promise<MessageSQL> {
        return await messageRepo.save(
            new MessageSQL({
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
            } as any),
        );
    };

    const execute = async function (cookie: string, ropBuffer: Buffer) {
        const body = new BufferWriter();
        body.writeUInt32LE(0);
        body.writeUInt32LE(ropBuffer.length);
        body.writeBytes(ropBuffer);
        body.writeUInt32LE(256 * 1024);
        body.writeUInt32LE(0);
        return mapiRequest(
            server.getApplication(),
            baseUrl,
            {
                Authorization: "jwt " + ownerToken,
                "X-RequestType": "Execute",
                "Content-Type": "application/mapi-http",
                Cookie: cookie,
            },
            body.toBuffer(),
        );
    };

    const connect = async function () {
        return mapiRequest(
            server.getApplication(),
            baseUrl,
            {
                Authorization: "jwt " + ownerToken,
                "X-RequestType": "Connect",
                "Content-Type": "application/mapi-http",
            },
            Buffer.alloc(0),
        );
    };

    beforeAll(async () => {
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("sql");
        if (isSqlDataSource(conn)) {
            mailboxRepo = conn.getRepository(MailboxSQL);
            folderRepo = conn.getRepository(FolderSQL);
            messageRepo = conn.getRepository(MessageSQL);
        } else {
            throw new Error("Could not find sql connection");
        }
        const aclConn: any = connMgr?.connections.get("acl");
        if (isSqlDataSource(aclConn)) {
            aclRepo = aclConn.getRepository(AccessControlListSQL);
        } else {
            throw new Error("Could not find sql acl connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        await mailboxRepo.clear();
        await folderRepo.clear();
        await messageRepo.clear();
        await aclRepo.clear();
    });

    it("Establishes a session and returns a well-formed Connect success body.", async () => {
        await createMailbox(owner.uid, { displayName: "Ada Lovelace" });
        const result = await connect();

        expect(result.status).toBe(200);
        const cookie = cookieHeaderFrom(result.headers["set-cookie"]);
        expect(cookie).toContain("MapiContext=");

        const reader = new BufferReader(result.body);
        expect(reader.readUInt32LE()).toBe(0); // StatusCode
        expect(reader.readUInt32LE()).toBe(0); // ErrorCode
        reader.readUInt32LE(); // PollsMax
        reader.readUInt32LE(); // RetryCount
        reader.readUInt32LE(); // RetryDelay
        reader.readNullTerminatedString8(); // DnPrefix
        expect(reader.readNullTerminatedUtf16LE()).toBe("Ada Lovelace");
    });

    it("Echoes back an empty but well-formed ROP buffer for a valid session.", async () => {
        await createMailbox(owner.uid);
        const connectResult = await connect();
        const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

        const inputRop = encodeRopBuffer({ ropsList: Buffer.alloc(0), handleTable: [42] });
        const requestBody = new BufferWriter();
        requestBody.writeUInt32LE(0);
        requestBody.writeUInt32LE(inputRop.length);
        requestBody.writeBytes(inputRop);
        requestBody.writeUInt32LE(256 * 1024);
        requestBody.writeUInt32LE(0);

        const result = await mapiRequest(
            server.getApplication(),
            baseUrl,
            {
                Authorization: "jwt " + ownerToken,
                "X-RequestType": "Execute",
                "Content-Type": "application/mapi-http",
                Cookie: cookie,
            },
            requestBody.toBuffer(),
        );

        expect(result.status).toBe(200);
        expect(result.headers["x-responsecode"]).toBe("0");
        const reader = new BufferReader(result.body);
        expect(reader.readUInt32LE()).toBe(0); // StatusCode
        expect(reader.readUInt32LE()).toBe(0); // ErrorCode
        reader.readUInt32LE(); // Flags
        const responseRopBufferSize = reader.readUInt32LE();
        const responseRopBuffer = reader.readBytes(responseRopBufferSize);
        expect(responseRopBuffer.readUInt16LE(0)).toBe(2);
        expect(responseRopBuffer.readUInt32LE(2)).toBe(42);
    });

    it("Logs on to a real mailbox and returns 13 well-formed, distinct FIDs.", async () => {
        const mailbox = await createMailbox(owner.uid);
        const connectResult = await connect();
        const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

        const logonRops = new BufferWriter();
        logonRops.writeUInt8(0xfe); // RopId
        logonRops.writeUInt8(0); // LogonId
        logonRops.writeUInt8(0); // OutputHandleIndex
        logonRops.writeUInt8(0x01); // LogonFlags (Private)
        logonRops.writeUInt32LE(0); // OpenFlags
        logonRops.writeUInt32LE(0); // StoreState
        logonRops.writeUInt16LE(0); // EssdnSize
        const inputRop = encodeRopBuffer({ ropsList: logonRops.toBuffer(), handleTable: [0xffffffff] });

        const requestBody = new BufferWriter();
        requestBody.writeUInt32LE(0);
        requestBody.writeUInt32LE(inputRop.length);
        requestBody.writeBytes(inputRop);
        requestBody.writeUInt32LE(256 * 1024);
        requestBody.writeUInt32LE(0);

        const result = await mapiRequest(
            server.getApplication(),
            baseUrl,
            {
                Authorization: "jwt " + ownerToken,
                "X-RequestType": "Execute",
                "Content-Type": "application/mapi-http",
                Cookie: cookie,
            },
            requestBody.toBuffer(),
        );

        expect(result.status).toBe(200);
        expect(result.headers["x-responsecode"]).toBe("0");
        const reader = new BufferReader(result.body);
        reader.readUInt32LE(); // StatusCode
        reader.readUInt32LE(); // ErrorCode
        reader.readUInt32LE(); // Flags
        const ropBufferSize = reader.readUInt32LE();
        const { ropsList } = decodeRopBuffer(reader.readBytes(ropBufferSize));

        const ropsReader = new BufferReader(ropsList);
        expect(ropsReader.readUInt8()).toBe(0xfe); // RopId
        expect(ropsReader.readUInt8()).toBe(0); // OutputHandleIndex
        expect(ropsReader.readUInt32LE()).toBe(0); // ReturnValue
        expect(ropsReader.readUInt8()).toBe(0x01); // LogonFlags, echoed

        const fids: bigint[] = [];
        for (let i = 0; i < 13; i++) {
            fids.push(ropsReader.readBigUInt64LE());
        }
        expect(new Set(fids).size).toBe(13);

        ropsReader.readUInt8(); // ResponseFlags
        expect(decodeGuid(ropsReader)).toBe(mailbox.uid); // MailboxGuid
    });

    it("Browses the top-level folder list end to end: Logon, OpenFolder(root), GetHierarchyTable, SetColumns, QueryRows.", async () => {
        const mailbox = await createMailbox(owner.uid);
        await createFolder(mailbox.uid, FolderType.INBOX, "Inbox");
        await createFolder(mailbox.uid, FolderType.USER, "Archive");
        const connectResult = await connect();
        const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

        const logonRops = new BufferWriter();
        logonRops.writeUInt8(0xfe);
        logonRops.writeUInt8(0);
        logonRops.writeUInt8(0);
        logonRops.writeUInt8(0x01);
        logonRops.writeUInt32LE(0);
        logonRops.writeUInt32LE(0);
        logonRops.writeUInt16LE(0);
        const logonResult = await execute(cookie, encodeRopBuffer({ ropsList: logonRops.toBuffer(), handleTable: [0xffffffff] }));
        const logonReader = new BufferReader(logonResult.body);
        logonReader.readUInt32LE();
        logonReader.readUInt32LE();
        logonReader.readUInt32LE();
        const { ropsList: logonRopsList } = decodeRopBuffer(logonReader.readBytes(logonReader.readUInt32LE()));
        const logonRopsReader = new BufferReader(logonRopsList);
        logonRopsReader.readUInt8();
        logonRopsReader.readUInt8();
        logonRopsReader.readUInt32LE();
        logonRopsReader.readUInt8();
        const rootFid = logonRopsReader.readBigUInt64LE();

        const openFolderRops = new BufferWriter();
        openFolderRops.writeUInt8(0x02);
        openFolderRops.writeUInt8(0);
        openFolderRops.writeUInt8(0); // InputHandleIndex (logon)
        openFolderRops.writeUInt8(1); // OutputHandleIndex
        openFolderRops.writeUInt8(0); // OpenModeFlags
        openFolderRops.writeBigUInt64LE(rootFid);
        await execute(cookie, encodeRopBuffer({ ropsList: openFolderRops.toBuffer(), handleTable: [0xffffffff, 0xffffffff] }));

        const tableRops = new BufferWriter();
        tableRops.writeUInt8(0x04);
        tableRops.writeUInt8(0);
        tableRops.writeUInt8(1); // InputHandleIndex (folder)
        tableRops.writeUInt8(2); // OutputHandleIndex
        tableRops.writeUInt8(0); // TableFlags
        await execute(cookie, encodeRopBuffer({ ropsList: tableRops.toBuffer(), handleTable: [0xffffffff, 0xffffffff, 0xffffffff] }));

        const setColumnsRops = new BufferWriter();
        setColumnsRops.writeUInt8(0x12);
        setColumnsRops.writeUInt8(0);
        setColumnsRops.writeUInt8(2); // InputHandleIndex (table)
        setColumnsRops.writeUInt8(0); // SetColumnsFlags
        setColumnsRops.writeUInt16LE(1);
        writePropertyTag(setColumnsRops, { propertyId: 0x3001, propertyType: PropertyType.PtypString });
        await execute(cookie, encodeRopBuffer({ ropsList: setColumnsRops.toBuffer(), handleTable: [0xffffffff] }));

        const queryRowsRops = new BufferWriter();
        queryRowsRops.writeUInt8(0x15);
        queryRowsRops.writeUInt8(0);
        queryRowsRops.writeUInt8(2); // InputHandleIndex (table)
        queryRowsRops.writeUInt8(0); // QueryRowsFlags
        queryRowsRops.writeUInt8(1); // ForwardRead
        queryRowsRops.writeUInt16LE(10);
        const queryRowsResult = await execute(cookie, encodeRopBuffer({ ropsList: queryRowsRops.toBuffer(), handleTable: [0xffffffff] }));

        const queryRowsReader = new BufferReader(queryRowsResult.body);
        queryRowsReader.readUInt32LE();
        queryRowsReader.readUInt32LE();
        queryRowsReader.readUInt32LE();
        const { ropsList: queryRowsList } = decodeRopBuffer(queryRowsReader.readBytes(queryRowsReader.readUInt32LE()));
        const rowsReader = new BufferReader(queryRowsList);
        rowsReader.readUInt8();
        rowsReader.readUInt8();
        expect(rowsReader.readUInt32LE()).toBe(0); // ReturnValue
        rowsReader.readUInt8(); // Origin
        const rowCount = rowsReader.readUInt16LE();
        expect(rowCount).toBe(2);

        const names: string[] = [];
        for (let i = 0; i < rowCount; i++) {
            rowsReader.readUInt8(); // PropertyRow Flags
            names.push(readPropertyValue(rowsReader, PropertyType.PtypString) as string);
        }
        expect(names.sort()).toEqual(["Archive", "Inbox"]);
    });

    it("Lists a folder's messages end to end: Logon, OpenFolder(inbox), GetContentsTable, SetColumns, QueryRows.", async () => {
        const mailbox = await createMailbox(owner.uid);
        const inbox = await createFolder(mailbox.uid, FolderType.INBOX, "Inbox");
        await createMessage(mailbox.uid, inbox.uid, { subject: "Hello World" });
        await createMessage(mailbox.uid, inbox.uid, { subject: "Second Message" });
        const connectResult = await connect();
        const cookie = cookieHeaderFrom(connectResult.headers["set-cookie"]);

        const logonRops = new BufferWriter();
        logonRops.writeUInt8(0xfe);
        logonRops.writeUInt8(0);
        logonRops.writeUInt8(0);
        logonRops.writeUInt8(0x01);
        logonRops.writeUInt32LE(0);
        logonRops.writeUInt32LE(0);
        logonRops.writeUInt16LE(0);
        const logonResult = await execute(cookie, encodeRopBuffer({ ropsList: logonRops.toBuffer(), handleTable: [0xffffffff] }));
        const logonReader = new BufferReader(logonResult.body);
        logonReader.readUInt32LE();
        logonReader.readUInt32LE();
        logonReader.readUInt32LE();
        const { ropsList: logonRopsList } = decodeRopBuffer(logonReader.readBytes(logonReader.readUInt32LE()));
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

        const openFolderRops = new BufferWriter();
        openFolderRops.writeUInt8(0x02);
        openFolderRops.writeUInt8(0);
        openFolderRops.writeUInt8(0); // InputHandleIndex (logon)
        openFolderRops.writeUInt8(1); // OutputHandleIndex
        openFolderRops.writeUInt8(0); // OpenModeFlags
        openFolderRops.writeBigUInt64LE(inboxFid);
        await execute(cookie, encodeRopBuffer({ ropsList: openFolderRops.toBuffer(), handleTable: [0xffffffff, 0xffffffff] }));

        const tableRops = new BufferWriter();
        tableRops.writeUInt8(0x05);
        tableRops.writeUInt8(0);
        tableRops.writeUInt8(1); // InputHandleIndex (folder)
        tableRops.writeUInt8(2); // OutputHandleIndex
        tableRops.writeUInt8(0); // TableFlags
        await execute(cookie, encodeRopBuffer({ ropsList: tableRops.toBuffer(), handleTable: [0xffffffff, 0xffffffff, 0xffffffff] }));

        const setColumnsRops = new BufferWriter();
        setColumnsRops.writeUInt8(0x12);
        setColumnsRops.writeUInt8(0);
        setColumnsRops.writeUInt8(2); // InputHandleIndex (table)
        setColumnsRops.writeUInt8(0); // SetColumnsFlags
        setColumnsRops.writeUInt16LE(1);
        writePropertyTag(setColumnsRops, { propertyId: 0x0037, propertyType: PropertyType.PtypString });
        await execute(cookie, encodeRopBuffer({ ropsList: setColumnsRops.toBuffer(), handleTable: [0xffffffff] }));

        const queryRowsRops = new BufferWriter();
        queryRowsRops.writeUInt8(0x15);
        queryRowsRops.writeUInt8(0);
        queryRowsRops.writeUInt8(2); // InputHandleIndex (table)
        queryRowsRops.writeUInt8(0); // QueryRowsFlags
        queryRowsRops.writeUInt8(1); // ForwardRead
        queryRowsRops.writeUInt16LE(10);
        const queryRowsResult = await execute(cookie, encodeRopBuffer({ ropsList: queryRowsRops.toBuffer(), handleTable: [0xffffffff] }));

        const queryRowsReader = new BufferReader(queryRowsResult.body);
        queryRowsReader.readUInt32LE();
        queryRowsReader.readUInt32LE();
        queryRowsReader.readUInt32LE();
        const { ropsList: queryRowsList } = decodeRopBuffer(queryRowsReader.readBytes(queryRowsReader.readUInt32LE()));
        const rowsReader = new BufferReader(queryRowsList);
        rowsReader.readUInt8();
        rowsReader.readUInt8();
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
    });
});
