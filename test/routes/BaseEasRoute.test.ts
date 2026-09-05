///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Isolated unit tests for BaseEasRoute, reserved ONLY for the defensive guard branches a real wired server
// can never exercise: `!this.deviceSyncStateRepo || !this.mailboxRepo` (DI always populates both before a
// request can reach a route) and `!user` (the `@Auth(["jwt"])` decorator itself already rejects an
// unauthenticated request with 401 before `dispatch()`'s own body ever runs - this is a second, defensive
// check for the rare case `dispatch()` is invoked directly, same rationale `BaseFolderRoute.test.ts` and
// `BaseMessageRoute.test.ts` already use for their own guard clauses). Every other behavior (query-parameter
// validation, mailbox resolution, DeviceSyncState find-or-create, the provisioning gate, unimplemented-command
// handling) is exercised via real HTTP+DB requests in test/routes/mongo/EasRoute.test.ts (and its sql/
// counterpart), matching this library's real-server-integration-test convention.
import config from "../config.js";
import { ObjectFactory } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import { BaseEasRoute } from "../../src/eas/BaseEasRoute.js";

class TestEasRoute extends BaseEasRoute<any> {
    protected deviceSyncStateClass: any = { name: "TestDeviceSyncState" };
    protected mailboxClass: any = { name: "TestMailbox" };
}

function makeReq(): any {
    return { query: { Cmd: "FolderSync", DeviceId: "dev1" }, rawBody: undefined };
}

function makeRes(): any {
    return {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
}

describe("BaseEasRoute Tests (guard clauses only)", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("dispatch() throws INTERNAL_ERROR when deviceSyncStateRepo/mailboxRepo are not set.", async () => {
        // `initialize: false` skips `@Init` (and `@Config`/`@Logger`/`@Inject`), leaving both repos
        // genuinely `undefined` - exactly what this guard clause exists to catch.
        const route = objectFactory.newInstance<TestEasRoute>(TestEasRoute, { initialize: false });

        await expect(route.dispatch(makeReq(), makeRes(), { uid: "user-1" } as any)).rejects.toThrow(
            /internal error/i,
        );
    });

    it("dispatch() throws AUTH_PERMISSION_FAILURE when no authenticated user is present.", async () => {
        const route = objectFactory.newInstance<TestEasRoute>(TestEasRoute, { initialize: false });
        // Poking the private repo fields directly (TypeScript `private` is compile-time only) isolates this
        // guard from the one above, which would otherwise fire first.
        (route as any).deviceSyncStateRepo = {};
        (route as any).mailboxRepo = {};

        await expect(route.dispatch(makeReq(), makeRes(), undefined)).rejects.toThrow(/permission/i);
    });
});
