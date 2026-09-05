///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// See the identical file header in test/routes/mongo/EasRoute.test.ts for the full rationale - this verifies
// the same BaseEasRoute transport plumbing and Provision/FolderSync command behavior on the SQL-backed
// variant.
import config from "../../config.sql.js";
import { request } from "@rapidrest/service-core/test";
import {
    Server,
    ObjectFactory,
    ConnectionManager,
    isSqlDataSource,
    ACLAction,
    AccessControlListSQL,
} from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { Repository } from "typeorm";
import { MailboxSQL } from "../../../src/models/sql/MailboxSQL.js";
import { FolderSQL } from "../../../src/models/sql/FolderSQL.js";
import { MessageSQL } from "../../../src/models/sql/MessageSQL.js";
import { DeviceSyncStateSQL } from "../../../src/models/sql/DeviceSyncStateSQL.js";
import { registerTestDoubles } from "../../testDoubles.js";
import { WbxmlEncoder } from "../../../src/eas/codec/WbxmlEncoder.js";
import { WbxmlDecoder } from "../../../src/eas/codec/WbxmlDecoder.js";
import { element, textElement, findChild, childText, type WbxmlElement } from "../../../src/eas/codec/WbxmlElement.js";
import { WbxmlCodePage } from "../../../src/eas/codec/WbxmlCodePages.js";
import { FolderType, MessageImportance, RecipientType } from "../../../src/models/types.js";

describe("Route:EasRouteSQL Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-sql", logger, objectFactory });
    const baseUrl = "/sql/eas";
    let mailboxRepo: Repository<MailboxSQL>;
    let folderRepo: Repository<FolderSQL>;
    let messageRepo: Repository<MessageSQL>;
    let deviceSyncStateRepo: Repository<DeviceSyncStateSQL>;
    let aclRepo: Repository<AccessControlListSQL>;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);

    /** See the identical helper in test/routes/mongo/EasRoute.test.ts for why the ACL seed matters here. */
    const createMailbox = async function (ownerUid: string): Promise<MailboxSQL> {
        const obj: MailboxSQL = new MailboxSQL({
            ownerUserUid: ownerUid,
            primarySmtpAddress: `${uuid.v4()}@example.com`,
            aliasAddresses: [],
            displayName: "Test Mailbox",
            timezone: "UTC",
            quotaBytes: 1_000_000_000,
            usedBytes: 0,
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

    const createFolderWithAcl = async function (mailboxUid: string, data: Partial<FolderSQL>): Promise<FolderSQL> {
        const result: FolderSQL = await folderRepo.save(
            new FolderSQL({ mailboxUid, unreadCount: 0, totalCount: 0, syncKeyVersion: 0, ...data } as any),
        );
        await aclRepo.save({
            uid: result.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records: [],
            parentUid: mailboxUid,
        } as any);
        return result;
    };

    /** See the identical helper in test/routes/mongo/EasRoute.test.ts. */
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
                receivedDate: new Date(),
                bodyBlobKey: `bodies/${uuid.v4()}`,
                bodyPreview: "Hello world",
                flags: { read: false, flagged: false, answered: false, forwarded: false },
                importance: MessageImportance.NORMAL,
                references: [],
                hasAttachments: false,
                ...data,
            } as any),
        );
    };

    /** See the identical helper in test/routes/mongo/EasRoute.test.ts. */
    const postWbxml = async function (cmd: string, deviceId: string, requestBody?: WbxmlElement): Promise<WbxmlElement> {
        const req = request(server.getApplication())
            .post(`${baseUrl}?Cmd=${cmd}&DeviceId=${deviceId}`)
            .set("Authorization", "jwt " + ownerToken)
            .set("Content-Type", "application/vnd.ms-sync.wbxml");
        const result = requestBody ? await req.send(new WbxmlEncoder().encode(requestBody)) : await req;
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        return new WbxmlDecoder().decode(Buffer.from(result.body));
    };

    /** See the identical helper in test/routes/mongo/EasRoute.test.ts. */
    const provisionDevice = async function (deviceId: string): Promise<void> {
        const phase1 = await postWbxml(
            "Provision",
            deviceId,
            element(WbxmlCodePage.Provision, "Provision", [
                element(WbxmlCodePage.Provision, "Policies", [
                    element(WbxmlCodePage.Provision, "Policy", [
                        textElement(WbxmlCodePage.Provision, "PolicyType", "MS-EAS-Provisioning-WBXML"),
                    ]),
                ]),
            ]),
        );
        const policyKey = childText(findChild(findChild(phase1, "Policies")!, "Policy")!, "PolicyKey")!;
        await postWbxml(
            "Provision",
            deviceId,
            element(WbxmlCodePage.Provision, "Provision", [
                element(WbxmlCodePage.Provision, "Policies", [
                    element(WbxmlCodePage.Provision, "Policy", [
                        textElement(WbxmlCodePage.Provision, "PolicyType", "MS-EAS-Provisioning-WBXML"),
                        textElement(WbxmlCodePage.Provision, "PolicyKey", policyKey),
                        textElement(WbxmlCodePage.Provision, "Status", "1"),
                    ]),
                ]),
            ]),
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
            deviceSyncStateRepo = conn.getRepository(DeviceSyncStateSQL);
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
        await deviceSyncStateRepo.clear();
        await messageRepo.clear();
        await folderRepo.clear();
        await mailboxRepo.clear();
        await aclRepo.clear();
    });

    describe("OPTIONS", () => {
        // See the identical note in test/routes/mongo/EasRoute.test.ts.
        it("Is answered by the framework's generic CORS preflight handler, not by this route.", async () => {
            const result = await request(server.getApplication()).options(baseUrl);
            expect(result.status).toBe(204);
            expect(result.headers["ms-asprotocolversions"]).toBeUndefined();
        });
    });

    describe("POST (dispatch)", () => {
        it("Requires authentication.", async () => {
            const result = await request(server.getApplication()).post(`${baseUrl}?Cmd=FolderSync&DeviceId=dev1`);
            expect(result.status).toBe(401);
        });

        it("Requires both Cmd and DeviceId query parameters.", async () => {
            await createMailbox(owner.uid);

            const missingCmd = await request(server.getApplication())
                .post(`${baseUrl}?DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);
            expect(missingCmd.status).toBe(400);

            const missingDeviceId = await request(server.getApplication())
                .post(`${baseUrl}?Cmd=FolderSync`)
                .set("Authorization", "jwt " + ownerToken);
            expect(missingDeviceId.status).toBe(400);
        });

        it("Returns 404 when the caller owns no mailbox.", async () => {
            const result = await request(server.getApplication())
                .post(`${baseUrl}?Cmd=FolderSync&DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);
            expect(result.status).toBe(404);
        });

        it("Creates a new (unprovisioned) DeviceSyncState on first contact from a device.", async () => {
            const mailbox = await createMailbox(owner.uid);

            await request(server.getApplication())
                .post(`${baseUrl}?Cmd=FolderSync&DeviceId=dev1&DeviceType=TestPhone`)
                .set("Authorization", "jwt " + ownerToken);

            const found = await deviceSyncStateRepo.findOne({ where: { mailboxUid: mailbox.uid, deviceId: "dev1" } });
            expect(found).not.toBeNull();
            expect(found?.deviceType).toBe("TestPhone");
            expect(found?.provisioned).toBe(false);
            expect(found?.folderSyncKeys).toEqual({});
        });

        it("Uses only the first value of a repeated query parameter (e.g. a client sending DeviceType twice).", async () => {
            const mailbox = await createMailbox(owner.uid);

            await request(server.getApplication())
                .post(`${baseUrl}?Cmd=FolderSync&DeviceId=dev1&DeviceType=First&DeviceType=Second`)
                .set("Authorization", "jwt " + ownerToken);

            const found = await deviceSyncStateRepo.findOne({ where: { mailboxUid: mailbox.uid, deviceId: "dev1" } });
            expect(found?.deviceType).toBe("First");
        });

        it("Rejects a non-Provision/Settings command from an unprovisioned device with HTTP 449 (Retry With).", async () => {
            await createMailbox(owner.uid);

            const result = await request(server.getApplication())
                .post(`${baseUrl}?Cmd=FolderSync&DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);

            expect(result.status).toBe(449);
        });

        it("Allows Settings through the provisioning gate even for an unprovisioned device (but 501s - no handler registered).", async () => {
            await createMailbox(owner.uid);

            const result = await request(server.getApplication())
                .post(`${baseUrl}?Cmd=Settings&DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);

            expect(result.status).toBe(501);
        });

        it("Returns 501 for a recognized-but-unimplemented command (Settings) once the device is already provisioned.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await deviceSyncStateRepo.save(
                new DeviceSyncStateSQL({
                    mailboxUid: mailbox.uid,
                    deviceId: "dev1",
                    deviceType: "TestPhone",
                    folderSyncKeys: {},
                    provisioned: true,
                }),
            );

            const result = await request(server.getApplication())
                .post(`${baseUrl}?Cmd=Settings&DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);

            expect(result.status).toBe(501);
        });

        it("Reuses the same DeviceSyncState across requests from the same (mailbox, device) pair rather than duplicating it.", async () => {
            const mailbox = await createMailbox(owner.uid);

            await request(server.getApplication())
                .post(`${baseUrl}?Cmd=Settings&DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);
            await request(server.getApplication())
                .post(`${baseUrl}?Cmd=Settings&DeviceId=dev1`)
                .set("Authorization", "jwt " + ownerToken);

            const all = await deviceSyncStateRepo.find({ where: { mailboxUid: mailbox.uid, deviceId: "dev1" } });
            expect(all.length).toBe(1);
        });
    });

    describe("Provision command", () => {
        it("Completes the two-phase handshake and marks the device provisioned.", async () => {
            await createMailbox(owner.uid);

            const phase1Request = element(WbxmlCodePage.Provision, "Provision", [
                element(WbxmlCodePage.Provision, "Policies", [
                    element(WbxmlCodePage.Provision, "Policy", [
                        textElement(WbxmlCodePage.Provision, "PolicyType", "MS-EAS-Provisioning-WBXML"),
                    ]),
                ]),
            ]);
            const phase1Response = await postWbxml("Provision", "dev1", phase1Request);
            expect(childText(phase1Response, "Status")).toBe("1");
            const phase1Policy = findChild(findChild(phase1Response, "Policies")!, "Policy")!;
            const policyKey = childText(phase1Policy, "PolicyKey");
            expect(policyKey).toBeTruthy();

            const afterPhase1 = await deviceSyncStateRepo.findOne({ where: { deviceId: "dev1" } });
            expect(afterPhase1?.policyKey).toBe(policyKey);
            expect(afterPhase1?.provisioned).toBe(false);

            const phase2Request = element(WbxmlCodePage.Provision, "Provision", [
                element(WbxmlCodePage.Provision, "Policies", [
                    element(WbxmlCodePage.Provision, "Policy", [
                        textElement(WbxmlCodePage.Provision, "PolicyType", "MS-EAS-Provisioning-WBXML"),
                        textElement(WbxmlCodePage.Provision, "PolicyKey", policyKey!),
                        textElement(WbxmlCodePage.Provision, "Status", "1"),
                    ]),
                ]),
            ]);
            const phase2Response = await postWbxml("Provision", "dev1", phase2Request);
            expect(childText(phase2Response, "Status")).toBe("1");
            const phase2Policy = findChild(findChild(phase2Response, "Policies")!, "Policy")!;
            expect(childText(phase2Policy, "PolicyKey")).toBe(policyKey);

            const afterPhase2 = await deviceSyncStateRepo.findOne({ where: { deviceId: "dev1" } });
            expect(afterPhase2?.provisioned).toBe(true);
        });

        it("Rejects phase 2 with a stale/incorrect PolicyKey without provisioning the device.", async () => {
            await createMailbox(owner.uid);

            await postWbxml(
                "Provision",
                "dev1",
                element(WbxmlCodePage.Provision, "Provision", [
                    element(WbxmlCodePage.Provision, "Policies", [
                        element(WbxmlCodePage.Provision, "Policy", [
                            textElement(WbxmlCodePage.Provision, "PolicyType", "MS-EAS-Provisioning-WBXML"),
                        ]),
                    ]),
                ]),
            );

            const badPhase2Response = await postWbxml(
                "Provision",
                "dev1",
                element(WbxmlCodePage.Provision, "Provision", [
                    element(WbxmlCodePage.Provision, "Policies", [
                        element(WbxmlCodePage.Provision, "Policy", [
                            textElement(WbxmlCodePage.Provision, "PolicyType", "MS-EAS-Provisioning-WBXML"),
                            textElement(WbxmlCodePage.Provision, "PolicyKey", "not-the-real-key"),
                            textElement(WbxmlCodePage.Provision, "Status", "1"),
                        ]),
                    ]),
                ]),
            );

            expect(childText(badPhase2Response, "Status")).toBe("2");
            const state = await deviceSyncStateRepo.findOne({ where: { deviceId: "dev1" } });
            expect(state?.provisioned).toBe(false);
        });
    });

    describe("FolderSync command", () => {
        it("Treats a request sent with no WBXML body at all the same as SyncKey '0' (initial sync).", async () => {
            await createMailbox(owner.uid);
            await provisionDevice("dev1");

            const response = await postWbxml("FolderSync", "dev1");

            expect(childText(response, "Status")).toBe("1");
            expect(childText(response, "SyncKey")).toBeTruthy();
        });

        it("Returns a fresh SyncKey with no items on the initial (SyncKey 0) request.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            await folderRepo.save(new FolderSQL({ mailboxUid: mailbox.uid, name: "Inbox", type: FolderType.INBOX, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }));

            const response = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", "0"),
                ]),
            );

            expect(childText(response, "Status")).toBe("1");
            expect(childText(response, "SyncKey")).not.toBe("0");
            expect(findChild(response, "Changes")).toBeUndefined();
        });

        it("Reports an existing folder as an Add on the first real sync round after the initial request.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await folderRepo.save(
                new FolderSQL({ mailboxUid: mailbox.uid, name: "Inbox", type: FolderType.INBOX, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
            );

            const initial = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", "0"),
                ]),
            );
            const initialKey = childText(initial, "SyncKey")!;

            const response = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", initialKey),
                ]),
            );

            expect(childText(response, "Status")).toBe("1");
            expect(childText(response, "SyncKey")).not.toBe(initialKey);
            const changes = findChild(response, "Changes")!;
            expect(childText(changes, "Count")).toBe("1");
            const add = findChild(changes, "Add")!;
            expect(childText(add, "ServerId")).toBe(folder.uid);
            expect(childText(add, "DisplayName")).toBe("Inbox");
            expect(childText(add, "ParentId")).toBe("0");
            expect(childText(add, "Type")).toBe("2");
        });

        it("Reports a folder renamed via the REST API as an Update on the next sync round.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Archive", type: FolderType.USER });
            // Backdated well outside computeChanges()'s NEWLY_CREATED_TOLERANCE_MS window, so the rename below
            // (which bumps only dateModified) is unambiguously an Update, not indistinguishable from a
            // brand-new Add - a real device wouldn't rename a folder within the same second it was created,
            // and this test shouldn't depend on a real wall-clock delay to reproduce that distinction.
            const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            await folderRepo.update({ uid: folder.uid }, { dateCreated: oldDate, dateModified: oldDate });

            const initial = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", "0"),
                ]),
            );
            const afterAdd = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", childText(initial, "SyncKey")!),
                ]),
            );

            const renameResult = await request(server.getApplication())
                .put(`/sql/folders/${folder.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({ uid: folder.uid, version: folder.version, name: "Renamed" });
            expect(renameResult.status).toBe(200);

            const response = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", childText(afterAdd, "SyncKey")!),
                ]),
            );

            const changes = findChild(response, "Changes")!;
            expect(childText(changes, "Count")).toBe("1");
            const update = findChild(changes, "Update")!;
            expect(childText(update, "ServerId")).toBe(folder.uid);
            expect(childText(update, "DisplayName")).toBe("Renamed");
        });

        it("Reports a folder deleted via the REST API as a Delete on the next sync round.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Archive", type: FolderType.USER });

            const initial = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", "0"),
                ]),
            );
            const afterAdd = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", childText(initial, "SyncKey")!),
                ]),
            );
            const keyAfterAdd = childText(afterAdd, "SyncKey")!;

            const deleteResult = await request(server.getApplication())
                .delete(`/sql/folders/${folder.uid}`)
                .set("Authorization", "jwt " + ownerToken);
            expect(deleteResult.status).toBeGreaterThanOrEqual(200);
            expect(deleteResult.status).toBeLessThan(300);

            const response = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", keyAfterAdd),
                ]),
            );

            const changes = findChild(response, "Changes")!;
            expect(childText(changes, "Count")).toBe("1");
            const del = findChild(changes, "Delete")!;
            expect(childText(del, "ServerId")).toBe(folder.uid);
        });

        it("Rejects an incorrect SyncKey with Status 3, forcing the client back to a full resync.", async () => {
            await createMailbox(owner.uid);
            await provisionDevice("dev1");

            const response = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", "999:2020-01-01T00:00:00.000Z"),
                ]),
            );

            expect(childText(response, "Status")).toBe("3");
        });

        it("Reports no Changes element when nothing changed since the last sync.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            await folderRepo.save(
                new FolderSQL({ mailboxUid: mailbox.uid, name: "Inbox", type: FolderType.INBOX, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
            );

            const initial = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", "0"),
                ]),
            );
            const afterAdd = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", childText(initial, "SyncKey")!),
                ]),
            );

            const noChangeResponse = await postWbxml(
                "FolderSync",
                "dev1",
                element(WbxmlCodePage.FolderHierarchy, "FolderSync", [
                    textElement(WbxmlCodePage.FolderHierarchy, "SyncKey", childText(afterAdd, "SyncKey")!),
                ]),
            );

            expect(childText(noChangeResponse, "Status")).toBe("1");
            expect(findChild(noChangeResponse, "Changes")).toBeUndefined();
        });
    });

    describe("Sync command", () => {
        const syncRequest = function (syncKey: string, collectionClass: string | undefined, folderUid: string | undefined): WbxmlElement {
            return element(WbxmlCodePage.AirSync, "Sync", [
                element(WbxmlCodePage.AirSync, "Collections", [
                    element(WbxmlCodePage.AirSync, "Collection", [
                        ...(collectionClass ? [textElement(WbxmlCodePage.AirSync, "Class", collectionClass)] : []),
                        textElement(WbxmlCodePage.AirSync, "SyncKey", syncKey),
                        ...(folderUid ? [textElement(WbxmlCodePage.AirSync, "CollectionId", folderUid)] : []),
                    ]),
                ]),
            ]);
        };

        it("Returns a fresh SyncKey with no items on the initial (SyncKey 0) request.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });

            const response = await postWbxml("Sync", "dev1", syncRequest("0", "Email", folder.uid));

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            expect(childText(collection, "Status")).toBe("1");
            expect(childText(collection, "SyncKey")).not.toBe("0");
            expect(findChild(collection, "Commands")).toBeUndefined();
        });

        it("Reports an existing message as an Add on the first real sync round after the initial request.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });
            const message = await createMessage(mailbox.uid, folder.uid, { subject: "Hello EAS" });

            const initial = await postWbxml("Sync", "dev1", syncRequest("0", "Email", folder.uid));
            const initialKey = childText(findChild(findChild(initial, "Collections")!, "Collection")!, "SyncKey")!;

            const response = await postWbxml("Sync", "dev1", syncRequest(initialKey, "Email", folder.uid));

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            expect(childText(collection, "Status")).toBe("1");
            expect(childText(collection, "SyncKey")).not.toBe(initialKey);
            const commands = findChild(collection, "Commands")!;
            const add = findChild(commands, "Add")!;
            expect(childText(add, "ServerId")).toBe(message.uid);
            const appData = findChild(add, "ApplicationData")!;
            expect(childText(appData, "Subject")).toBe("Hello EAS");
            expect(childText(appData, "From")).toBe("Sender <sender@example.com>");
            expect(childText(appData, "Read")).toBe("0");
        });

        it("Reports a message deleted via the REST API as a Delete on the next sync round.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });
            const message = await createMessage(mailbox.uid, folder.uid);

            const initial = await postWbxml("Sync", "dev1", syncRequest("0", "Email", folder.uid));
            const afterAdd = await postWbxml(
                "Sync",
                "dev1",
                syncRequest(childText(findChild(findChild(initial, "Collections")!, "Collection")!, "SyncKey")!, "Email", folder.uid),
            );
            const keyAfterAdd = childText(findChild(findChild(afterAdd, "Collections")!, "Collection")!, "SyncKey")!;

            const deleteResult = await request(server.getApplication())
                .delete(`/sql/messages/${message.uid}`)
                .set("Authorization", "jwt " + ownerToken);
            expect(deleteResult.status).toBeGreaterThanOrEqual(200);
            expect(deleteResult.status).toBeLessThan(300);

            const response = await postWbxml("Sync", "dev1", syncRequest(keyAfterAdd, "Email", folder.uid));

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            const commands = findChild(collection, "Commands")!;
            const del = findChild(commands, "Delete")!;
            expect(childText(del, "ServerId")).toBe(message.uid);
        });

        it("Rejects an incorrect SyncKey with Status 3, forcing the client back to a full resync.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });

            const response = await postWbxml("Sync", "dev1", syncRequest("999:2020-01-01T00:00:00.000Z", "Email", folder.uid));

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            expect(childText(collection, "Status")).toBe("3");
        });

        it("Returns a top-level Status 3 when the request has no Collection at all.", async () => {
            await createMailbox(owner.uid);
            await provisionDevice("dev1");

            const response = await postWbxml(
                "Sync",
                "dev1",
                element(WbxmlCodePage.AirSync, "Sync", [element(WbxmlCodePage.AirSync, "Collections", [])]),
            );

            expect(childText(response, "Status")).toBe("3");
        });

        it("Returns a per-collection Status 4 when CollectionId is missing.", async () => {
            await createMailbox(owner.uid);
            await provisionDevice("dev1");

            const response = await postWbxml("Sync", "dev1", syncRequest("0", "Email", undefined));

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            expect(childText(collection, "Status")).toBe("4");
        });

        it("Returns a per-collection Status 4 for an unsupported collection Class.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Contacts", type: FolderType.CONTACTS });

            const response = await postWbxml("Sync", "dev1", syncRequest("0", "Contacts", folder.uid));

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            expect(childText(collection, "Status")).toBe("4");
        });

        it("Reports no Commands when nothing changed since the last sync.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });
            await createMessage(mailbox.uid, folder.uid);

            const initial = await postWbxml("Sync", "dev1", syncRequest("0", "Email", folder.uid));
            const afterAdd = await postWbxml(
                "Sync",
                "dev1",
                syncRequest(childText(findChild(findChild(initial, "Collections")!, "Collection")!, "SyncKey")!, "Email", folder.uid),
            );

            const noChangeResponse = await postWbxml(
                "Sync",
                "dev1",
                syncRequest(childText(findChild(findChild(afterAdd, "Collections")!, "Collection")!, "SyncKey")!, "Email", folder.uid),
            );

            const collection = findChild(findChild(noChangeResponse, "Collections")!, "Collection")!;
            expect(childText(collection, "Status")).toBe("1");
            expect(findChild(collection, "Commands")).toBeUndefined();
        });

        it("Reports a message updated via the REST API as a Change on the next sync round.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });
            const message = await createMessage(mailbox.uid, folder.uid);
            // Backdated well outside computeChanges()'s NEWLY_CREATED_TOLERANCE_MS window - see the identical
            // reasoning on the FolderSync rename test above.
            const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            await messageRepo.update({ uid: message.uid }, { dateCreated: oldDate, dateModified: oldDate });

            const initial = await postWbxml("Sync", "dev1", syncRequest("0", "Email", folder.uid));
            const afterAdd = await postWbxml(
                "Sync",
                "dev1",
                syncRequest(childText(findChild(findChild(initial, "Collections")!, "Collection")!, "SyncKey")!, "Email", folder.uid),
            );

            const updateResult = await request(server.getApplication())
                .put(`/sql/messages/${message.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({ uid: message.uid, version: message.version, subject: "Updated Subject" });
            expect(updateResult.status).toBe(200);

            const response = await postWbxml(
                "Sync",
                "dev1",
                syncRequest(childText(findChild(findChild(afterAdd, "Collections")!, "Collection")!, "SyncKey")!, "Email", folder.uid),
            );

            const collection = findChild(findChild(response, "Collections")!, "Collection")!;
            const commands = findChild(collection, "Commands")!;
            const change = findChild(commands, "Change")!;
            expect(childText(change, "ServerId")).toBe(message.uid);
            expect(childText(findChild(change, "ApplicationData")!, "Subject")).toBe("Updated Subject");
        });

        it("Omits To and includes Cc/plain-address From for a message with no To recipients.", async () => {
            const mailbox = await createMailbox(owner.uid);
            await provisionDevice("dev1");
            const folder = await createFolderWithAcl(mailbox.uid, { name: "Inbox", type: FolderType.INBOX });
            await createMessage(mailbox.uid, folder.uid, {
                from: { address: "sender@example.com", type: RecipientType.TO },
                recipients: [{ address: "cc1@example.com", type: RecipientType.CC }],
            });

            const initial = await postWbxml("Sync", "dev1", syncRequest("0", "Email", folder.uid));
            const response = await postWbxml(
                "Sync",
                "dev1",
                syncRequest(childText(findChild(findChild(initial, "Collections")!, "Collection")!, "SyncKey")!, "Email", folder.uid),
            );

            const commands = findChild(findChild(findChild(response, "Collections")!, "Collection")!, "Commands")!;
            const appData = findChild(findChild(commands, "Add")!, "ApplicationData")!;
            expect(childText(appData, "From")).toBe("sender@example.com");
            expect(findChild(appData, "To")).toBeUndefined();
            expect(childText(appData, "Cc")).toBe("cc1@example.com");
        });
    });
});
