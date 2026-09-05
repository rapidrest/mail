///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { DeviceSyncStateSQL, MailboxSQL } from "../../sql.js";
import { BaseEasRoute } from "../BaseEasRoute.js";

/**
 * SQL-backed concrete `BaseEasRoute`. See `EasRouteMongo.ts`'s doc comment - the same mounting pattern
 * applies here.
 *
 * @author Jean-Philippe Steinmetz
 */
export class EasRouteSQL extends BaseEasRoute<DeviceSyncStateSQL, MailboxSQL> {
    protected deviceSyncStateClass: any = DeviceSyncStateSQL;
    protected mailboxClass: any = MailboxSQL;
}
