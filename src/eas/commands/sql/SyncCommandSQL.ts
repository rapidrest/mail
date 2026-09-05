///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { MessageSQL } from "../../../sql.js";
import { EmailSyncAdapter } from "../../adapters/EmailSyncAdapter.js";
import { SyncCommand, type SyncCollectionBinding } from "../SyncCommand.js";

/**
 * @author Jean-Philippe Steinmetz
 */
export class SyncCommandSQL extends SyncCommand {
    protected collectionBindings: Record<string, SyncCollectionBinding<any>> = {
        Email: { entityClass: MessageSQL, adapter: new EmailSyncAdapter() },
    };
}
