///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/**
 * MAPI-over-HTTP protocol compatibility (RPC-over-HTTP transport, EMSMDB/ROP handlers, minimal NSPI address
 * book support) is Phase 3 of this library's roadmap and has not been implemented yet — see the architecture
 * plan's "MAPI over HTTP (Phase 3)" section for the intended design (RPC-over-HTTP framing in `codec/`, one
 * handler class per supported ROP in `rop/`, `MapiSessionManager` for Redis-backed session state).
 *
 * This module exists as a stable import target (`@rapidrest/mail/mapi`) so consuming applications and the
 * package's `exports` map are already wired up for when that work lands.
 */
export const MAPI_NOT_YET_IMPLEMENTED = true;
