///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Isolated unit tests for BaseMapiEmsmdbRoute, reserved for the defensive guard branches a real wired server
// can never exercise (`!this.mailboxRepo || !this.folderRepo || !this.messageRepo || !this.sessionManager ||
// !this.blobStore` - DI always populates all five before a request can reach a route - and `!user`, a second
// defensive check behind `@Auth(["jwt"])` itself) - the same rationale test/routes/BaseEasRoute.test.ts already
// uses for its own identical guards. Every other behavior is exercised via real HTTP+DB requests in
// test/routes/mongo/MapiEmsmdbRoute.test.ts (and its sql/ counterpart).
import config from "../config.js";
import { ObjectFactory } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import { BaseMapiEmsmdbRoute } from "../../src/mapi/BaseMapiEmsmdbRoute.js";

class TestMapiEmsmdbRoute extends BaseMapiEmsmdbRoute<any> {
    protected mailboxClass: any = { name: "TestMailbox" };
    protected folderClass: any = { name: "TestFolder" };
    protected messageClass: any = { name: "TestMessage" };
}

function makeReq(): any {
    return { headers: { "x-requesttype": "Connect" }, cookies: {}, rawBody: undefined };
}

function makeRes(): any {
    return {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        appendHeader: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
}

describe("BaseMapiEmsmdbRoute Tests (guard clauses only)", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("dispatch() throws INTERNAL_ERROR when mailboxRepo/folderRepo/messageRepo/sessionManager/blobStore are not set.", async () => {
        // `initialize: false` skips `@Init`, leaving all five genuinely `undefined` - exactly what this
        // guard clause exists to catch.
        const route = objectFactory.newInstance<TestMapiEmsmdbRoute>(TestMapiEmsmdbRoute, { initialize: false });

        await expect(route.dispatch(makeReq(), makeRes(), { uid: "user-1" } as any)).rejects.toThrow(
            /internal error/i,
        );
    });

    it("dispatch() throws AUTH_PERMISSION_FAILURE when no authenticated user is present.", async () => {
        const route = objectFactory.newInstance<TestMapiEmsmdbRoute>(TestMapiEmsmdbRoute, { initialize: false });
        // Poking the private fields directly (TypeScript `private` is compile-time only) isolates this guard
        // from the one above, which would otherwise fire first.
        (route as any).mailboxRepo = {};
        (route as any).folderRepo = {};
        (route as any).messageRepo = {};
        (route as any).sessionManager = {};
        (route as any).blobStore = {};

        await expect(route.dispatch(makeReq(), makeRes(), undefined)).rejects.toThrow(/permission/i);
    });
});
