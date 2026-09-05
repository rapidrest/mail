///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// See the identical file header in test/routes/mongo/AutodiscoverRoute.test.ts for the full rationale - this
// verifies the same BaseAutodiscoverRoute behavior on the SQL-backed variant, including the
// AutodiscoverRouteSQL.aliasQueryValue() escaping override (test/routes/mongo's alias-match test doesn't
// exercise that SQL-specific `simple-json`-column code path at all).
import config from "../../config.sql.js";
import { request } from "@rapidrest/service-core/test";
import { Server, ObjectFactory, ConnectionManager, isSqlDataSource } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { Repository } from "typeorm";
import { MailboxSQL } from "../../../src/models/sql/MailboxSQL.js";
import { registerTestDoubles } from "../../testDoubles.js";

describe("Route:AutodiscoverRouteSQL Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-sql", logger, objectFactory });
    const baseUrl = "/sql/autodiscover";
    let mailboxRepo: Repository<MailboxSQL>;

    const createMailbox = async function (data?: Partial<MailboxSQL>): Promise<MailboxSQL> {
        const obj: MailboxSQL = new MailboxSQL({
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
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        await mailboxRepo.clear();
    });

    describe("POST .../autodiscover.xml (POX)", () => {
        it("Returns a MobileSync settings response for a known primarySmtpAddress.", async () => {
            const mailbox = await createMailbox({ displayName: "Ada Lovelace" });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody(mailbox.primarySmtpAddress));

            expect(result.status).toBe(200);
            expect(result.text).toContain(`<autodiscover:EMailAddress>${mailbox.primarySmtpAddress}</autodiscover:EMailAddress>`);
            expect(result.text).toContain("<autodiscover:DisplayName>Ada Lovelace</autodiscover:DisplayName>");
        });

        it("Matches against the serialized aliasAddresses column via the escaped LIKE override.", async () => {
            const alias = `${uuid.v4()}@example.com`;
            await createMailbox({ aliasAddresses: [alias] });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody(alias));

            expect(result.status).toBe(200);
            expect(result.text).toContain(`<autodiscover:EMailAddress>${alias}</autodiscover:EMailAddress>`);
        });

        it("Does not false-positive-match a substring of a stored alias.", async () => {
            await createMailbox({ aliasAddresses: [`bob@example.com`] });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody("ob@example.co"));

            expect(result.status).toBe(404);
        });

        it("Treats '%'/'_' in the request address as literal characters, not SQL LIKE wildcards.", async () => {
            // See the identical rationale in test/routes/sql/MailIngestRoute.test.ts - without escaping, a `_`
            // (SQL "match any one character" wildcard) in the request address would let "b_b@example.com"
            // falsely match a stored alias "bob@example.com".
            await createMailbox({ aliasAddresses: ["bob@example.com"] });

            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody("b_b@example.com"));

            expect(result.status).toBe(404);
        });

        it("Returns 404 for an address with no matching Mailbox.", async () => {
            const result = await request(server.getApplication())
                .post(`${baseUrl}/autodiscover.xml`)
                .set("Content-Type", "text/xml")
                .send(poxRequestBody("nobody@example.com"));
            expect(result.status).toBe(404);
        });
    });

    describe("GET .../autodiscover.json/v1.0/:email (v2)", () => {
        it("Returns the EAS URL for a known address.", async () => {
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
    });
});
