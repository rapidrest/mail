///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// These tests prove BaseAutodiscoverRoute's real HTTP behavior for both endpoints it exposes - classic POX
// (`POST .../autodiscover.xml`) and Autodiscover v2 (`GET .../autodiscover.json/v1.0/:email`) - against a real
// server + real Mongo, with no authentication (see the architecture plan's Autodiscover section for why both
// endpoints are deliberately unauthenticated).
import config from "../../config.js";
import { request } from "@rapidrest/service-core/test";
import { MongoConnection, MongoRepository, Server, ObjectFactory, ConnectionManager } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { MailboxMongo } from "../../../src/models/mongo/MailboxMongo.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { registerTestDoubles } from "../../testDoubles.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

describe("Route:AutodiscoverRouteMongo Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-mongo", logger, objectFactory });
    const baseUrl = "/mongo/autodiscover";
    let mailboxRepo: MongoRepository<MailboxMongo>;

    const createMailbox = async function (data?: Partial<MailboxMongo>): Promise<MailboxMongo> {
        const obj: MailboxMongo = new MailboxMongo({
            ownerUserUid: uuid.v4(),
            primarySmtpAddress: `${uuid.v4()}@example.com`,
            aliasAddresses: [],
            displayName: "Test Mailbox",
            timezone: "UTC",
            quotaBytes: 1_000_000_000,
            usedBytes: 0,
            ...data,
        });
        return await mailboxRepo.save(obj);
    };

    const poxRequestBody = function (email: string): string {
        return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="https://schemas.microsoft.com/exchange/autodiscover/mobilesync/requestschema/2006">
    <Request>
        <EMailAddress>${email}</EMailAddress>
        <AcceptableResponseSchema>https://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006</AcceptableResponseSchema>
    </Request>
</Autodiscover>`;
    };

    const outlookPoxRequestBody = function (email: string): string {
        return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006">
    <Request>
        <EMailAddress>${email}</EMailAddress>
        <AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema>
    </Request>
</Autodiscover>`;
    };

    beforeAll(async () => {
        await mongod.start();
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("mongo");
        if (conn instanceof MongoConnection) {
            mailboxRepo = conn.getMongoRepository("MailboxMongo");
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
        try {
            await mailboxRepo.clear();
        } catch (err: any) {
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    });

    describe("POST .../autodiscover.xml (POX)", () => {
        it("Requires no authentication.", async () => {
            const mailbox = await createMailbox();
            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody(mailbox.primarySmtpAddress));
            expect(result.status).toBe(200);
        });

        it("Returns a MobileSync settings response for a known primarySmtpAddress.", async () => {
            const mailbox = await createMailbox({ displayName: "Ada Lovelace" });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody(mailbox.primarySmtpAddress));

            expect(result.status).toBe(200);
            expect(result.headers["content-type"]).toContain("application/xml");
            const xml = result.text;
            expect(xml).toContain(`<autodiscover:EMailAddress>${mailbox.primarySmtpAddress}</autodiscover:EMailAddress>`);
            expect(xml).toContain("<autodiscover:DisplayName>Ada Lovelace</autodiscover:DisplayName>");
            expect(xml).toContain("<autodiscover:Type>MobileSync</autodiscover:Type>");
            expect(xml).toContain("<autodiscover:Url>https://mail.example.com/Microsoft-Server-ActiveSync</autodiscover:Url>");
        });

        it("Matches against aliasAddresses, not only primarySmtpAddress.", async () => {
            const alias = `${uuid.v4()}@example.com`;
            await createMailbox({ aliasAddresses: [alias] });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody(alias));

            expect(result.status).toBe(200);
            expect(result.text).toContain(`<autodiscover:EMailAddress>${alias}</autodiscover:EMailAddress>`);
        });

        it("Matches case-insensitively.", async () => {
            const mailbox = await createMailbox();

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody(mailbox.primarySmtpAddress.toUpperCase()));

            expect(result.status).toBe(200);
        });

        it("Returns 404 for an address with no matching Mailbox.", async () => {
            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody("nobody@example.com"));
            expect(result.status).toBe(404);
        });

        it("Returns 400 when the request body has no EMailAddress element.", async () => {
            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send("<Autodiscover><Request></Request></Autodiscover>");
            expect(result.status).toBe(400);
        });

        it("Returns an Outlook/EXCH mapiHttp response when AcceptableResponseSchema requests the Outlook schema.", async () => {
            const mailbox = await createMailbox({ displayName: "Ada Lovelace" });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(outlookPoxRequestBody(mailbox.primarySmtpAddress));

            expect(result.status).toBe(200);
            expect(result.headers["content-type"]).toContain("application/xml");
            const xml = result.text;
            expect(xml).toContain("http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a");
            expect(xml).toContain(`<AutoDiscoverSMTPAddress>${mailbox.primarySmtpAddress}</AutoDiscoverSMTPAddress>`);
            expect(xml).toContain("<DisplayName>Ada Lovelace</DisplayName>");
            expect(xml).toContain('<Protocol Type="mapiHttp" Version="1">');
            expect(xml).toContain("<InternalUrl>https://mail.example.com/mapi/emsmdb</InternalUrl>");
            expect(xml).not.toContain("<autodiscover:Type>MobileSync</autodiscover:Type>");
        });
    });

    describe("GET .../autodiscover.json/v1.0/:email (v2)", () => {
        it("Requires no authentication and returns the EAS URL for a known address.", async () => {
            const mailbox = await createMailbox();

            const result = await request(server.getApplication()).get(
                `${baseUrl}/autodiscover.json/v1.0/${encodeURIComponent(mailbox.primarySmtpAddress)}?Protocol=ActiveSync`,
            );

            expect(result.status).toBe(200);
            expect(result.body).toEqual({
                Protocol: "ActiveSync",
                Url: "https://mail.example.com/Microsoft-Server-ActiveSync",
            });
        });

        it("Matches against aliasAddresses, not only primarySmtpAddress.", async () => {
            const alias = `${uuid.v4()}@example.com`;
            await createMailbox({ aliasAddresses: [alias] });

            const result = await request(server.getApplication()).get(
                `${baseUrl}/autodiscover.json/v1.0/${encodeURIComponent(alias)}?Protocol=ActiveSync`,
            );

            expect(result.status).toBe(200);
            expect(result.body.Url).toBe("https://mail.example.com/Microsoft-Server-ActiveSync");
        });

        it("Returns 404 JSON for an address with no matching Mailbox.", async () => {
            const result = await request(server.getApplication()).get(
                `${baseUrl}/autodiscover.json/v1.0/nobody@example.com?Protocol=ActiveSync`,
            );
            expect(result.status).toBe(404);
            expect(result.body.ErrorCode).toBe("UserNotFound");
        });

        it("Returns 400 JSON for an unsupported Protocol value.", async () => {
            const mailbox = await createMailbox();
            const result = await request(server.getApplication()).get(
                `${baseUrl}/autodiscover.json/v1.0/${encodeURIComponent(mailbox.primarySmtpAddress)}?Protocol=EWS`,
            );
            expect(result.status).toBe(400);
            expect(result.body.ErrorCode).toBe("ProtocolNotSupported");
        });

        it("Returns 400 JSON when Protocol is missing entirely.", async () => {
            const mailbox = await createMailbox();
            const result = await request(server.getApplication()).get(
                `${baseUrl}/autodiscover.json/v1.0/${encodeURIComponent(mailbox.primarySmtpAddress)}`,
            );
            expect(result.status).toBe(400);
        });
    });
});
