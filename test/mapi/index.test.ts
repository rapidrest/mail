///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Trivial smoke test for the `mapi` barrel module - it exists only as a stable import target for the
// not-yet-implemented Phase 3 (MAPI over HTTP) work, so there is nothing to exercise beyond its constant.
import { MAPI_NOT_YET_IMPLEMENTED } from "../../src/mapi/index.js";

describe("mapi/index Tests", () => {
    it("Exports MAPI_NOT_YET_IMPLEMENTED as true.", () => {
        expect(MAPI_NOT_YET_IMPLEMENTED).toBe(true);
    });
});
