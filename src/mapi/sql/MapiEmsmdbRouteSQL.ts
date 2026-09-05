///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { FolderSQL, MailboxSQL } from "../../sql.js";
import { BaseMapiEmsmdbRoute } from "../BaseMapiEmsmdbRoute.js";
import { RopLogonHandler } from "../rop/RopLogonHandler.js";
import { RopReleaseHandler } from "../rop/RopReleaseHandler.js";
import { RopOpenFolderHandler } from "../rop/RopOpenFolderHandler.js";
import { RopGetHierarchyTableHandler } from "../rop/RopGetHierarchyTableHandler.js";
import { RopSetColumnsHandler } from "../rop/RopSetColumnsHandler.js";
import { RopQueryRowsHandler } from "../rop/RopQueryRowsHandler.js";

/**
 * SQL-backed concrete `BaseMapiEmsmdbRoute`. See `MapiEmsmdbRouteMongo.ts`'s doc comment - the same mounting
 * pattern applies here.
 *
 * @author Jean-Philippe Steinmetz
 */
export class MapiEmsmdbRouteSQL extends BaseMapiEmsmdbRoute<MailboxSQL> {
    protected mailboxClass: any = MailboxSQL;
    protected folderClass: any = FolderSQL;
    protected ropHandlerClasses: any[] = [
        RopLogonHandler,
        RopReleaseHandler,
        RopOpenFolderHandler,
        RopGetHierarchyTableHandler,
        RopSetColumnsHandler,
        RopQueryRowsHandler,
    ];
}
