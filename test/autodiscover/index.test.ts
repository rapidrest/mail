///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Smoke test for the `autodiscover` barrel module (`@rapidrest/mail/autodiscover`) - every other Autodiscover
// test imports its subject directly from its concrete file, so this file's only job is to catch a typo'd or
// missing `export *` in src/autodiscover/index.ts itself. See test/eas/index.test.ts for the identical
// precedent this follows.
import * as Autodiscover from "../../src/autodiscover/index.js";

describe("autodiscover/index Tests", () => {
    it("Re-exports the XML request/response helpers.", () => {
        expect(typeof Autodiscover.extractEmailAddress).toBe("function");
        expect(typeof Autodiscover.escapeXml).toBe("function");
        expect(typeof Autodiscover.buildPoxSuccessXml).toBe("function");
    });

    it("Re-exports the abstract route base class.", () => {
        expect(typeof Autodiscover.BaseAutodiscoverRoute).toBe("function");
    });
});
