///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Trivial smoke test for the `eas` barrel module - it exists only as a stable import target for the
// not-yet-implemented Phase 2 (Exchange ActiveSync) work, so there is nothing to exercise beyond its constant.
import { EAS_NOT_YET_IMPLEMENTED } from "../../src/eas/index.js";

describe("eas/index Tests", () => {
    it("Exports EAS_NOT_YET_IMPLEMENTED as true.", () => {
        expect(EAS_NOT_YET_IMPLEMENTED).toBe(true);
    });
});
