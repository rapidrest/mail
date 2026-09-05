///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { DeviceSyncStateSQL, MailboxSQL } from "../../sql.js";
import { BaseEasRoute } from "../BaseEasRoute.js";
import { ProvisionCommand } from "../commands/ProvisionCommand.js";
import { PingCommand } from "../commands/PingCommand.js";
import { FolderSyncCommandSQL } from "../commands/sql/FolderSyncCommandSQL.js";
import { SyncCommandSQL } from "../commands/sql/SyncCommandSQL.js";

/**
 * SQL-backed concrete `BaseEasRoute`. See `EasRouteMongo.ts`'s doc comment - the same mounting pattern
 * applies here.
 *
 * @author Jean-Philippe Steinmetz
 */
export class EasRouteSQL extends BaseEasRoute<DeviceSyncStateSQL, MailboxSQL> {
    protected deviceSyncStateClass: any = DeviceSyncStateSQL;
    protected mailboxClass: any = MailboxSQL;
    protected commandHandlerClasses: any[] = [ProvisionCommand, FolderSyncCommandSQL, SyncCommandSQL, PingCommand];
}
