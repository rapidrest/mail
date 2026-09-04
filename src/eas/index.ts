///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/**
 * Exchange ActiveSync protocol compatibility (WBXML codec, `Provision`/`FolderSync`/`Sync`/`SendMail`/
 * `ItemOperations`/`Ping`/`Search`/`MeetingResponse`/`Settings` command handlers, `DeviceSyncState`-backed
 * sync cursors) is Phase 2 of this library's roadmap and has not been implemented yet — see the architecture
 * plan's "Exchange ActiveSync (Phase 2)" section for the intended design.
 *
 * This module exists as a stable import target (`@rapidrest/mail/eas`) so consuming applications and the
 * package's `exports` map are already wired up for when that work lands.
 */
export const EAS_NOT_YET_IMPLEMENTED = true;
