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
import { registerTestDoubles } from "../../testDoubles.js";
import { cookieHeaderFrom, mapiRequest } from "../../mapi/mapiTestClient.js";
import { BufferReader, BufferWriter } from "../../../src/mapi/codec/BufferCursor.js";
import { encodeRopBuffer } from "../../../src/mapi/codec/RopBuffer.js";

describe("Route:MapiEmsmdbRouteSQL Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-sql", logger, objectFactory });
    const baseUrl = "/sql/mapi/emsmdb";
    let mailboxRepo: Repository<MailboxSQL>;
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
});
