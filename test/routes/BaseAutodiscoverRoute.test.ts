///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Isolated unit tests for BaseAutodiscoverRoute, reserved for the defensive `!this.mailboxRepo` guard branches
// a real wired server can never exercise (DI always populates the repo via `@Init` before a request can reach
// a route) - the same rationale test/routes/BaseEasRoute.test.ts already uses for its own identical guard.
// Every other behavior (email extraction, mailbox resolution, both success/error response shapes) is exercised
// via real HTTP+DB requests in test/routes/mongo/AutodiscoverRoute.test.ts (and its sql/ counterpart).
import config from "../config.js";
import { ObjectFactory } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import { BaseAutodiscoverRoute } from "../../src/autodiscover/BaseAutodiscoverRoute.js";

class TestAutodiscoverRoute extends BaseAutodiscoverRoute<any> {
    protected mailboxClass: any = { name: "TestMailbox" };
    protected readonly easUrl = "https://mail.example.com/Microsoft-Server-ActiveSync";
}

function makeRes(): any {
    return {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
}

describe("BaseAutodiscoverRoute Tests (guard clauses only)", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("pox() sends a bare 500 when mailboxRepo is not set.", async () => {
        // `initialize: false` skips `@Init`, leaving mailboxRepo genuinely `undefined` - exactly what this
        // guard clause exists to catch.
        const route = objectFactory.newInstance<TestAutodiscoverRoute>(TestAutodiscoverRoute, {
            initialize: false,
        });
        const res = makeRes();

        await route.pox({ rawBody: undefined } as any, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith();
    });

    it("v2() sends a bare 500 when mailboxRepo is not set.", async () => {
        const route = objectFactory.newInstance<TestAutodiscoverRoute>(TestAutodiscoverRoute, {
            initialize: false,
        });
        const res = makeRes();

        await route.v2("someone@example.com", "ActiveSync", res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith();
    });
});
