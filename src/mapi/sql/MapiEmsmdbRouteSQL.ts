///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { FolderSQL, MailboxSQL, MessageSQL } from "../../sql.js";
import { BaseMapiEmsmdbRoute } from "../BaseMapiEmsmdbRoute.js";
import { RopLogonHandler } from "../rop/RopLogonHandler.js";
import { RopReleaseHandler } from "../rop/RopReleaseHandler.js";
import { RopOpenFolderHandler } from "../rop/RopOpenFolderHandler.js";
import { RopGetHierarchyTableHandler } from "../rop/RopGetHierarchyTableHandler.js";
import { RopGetContentsTableHandler } from "../rop/RopGetContentsTableHandler.js";
import { RopSetColumnsHandler } from "../rop/RopSetColumnsHandler.js";
import { RopQueryRowsHandler } from "../rop/RopQueryRowsHandler.js";
import { RopOpenMessageHandler } from "../rop/RopOpenMessageHandler.js";
import { RopGetPropertiesSpecificHandler } from "../rop/RopGetPropertiesSpecificHandler.js";
import { RopOpenStreamHandler } from "../rop/RopOpenStreamHandler.js";
import { RopReadStreamHandler } from "../rop/RopReadStreamHandler.js";
import { RopCreateMessageHandler } from "../rop/RopCreateMessageHandler.js";
import { RopSetPropertiesHandler } from "../rop/RopSetPropertiesHandler.js";
import { RopWriteStreamHandler } from "../rop/RopWriteStreamHandler.js";
import { RopSaveChangesMessageHandler } from "../rop/RopSaveChangesMessageHandler.js";
import { RopSubmitMessageHandler } from "../rop/RopSubmitMessageHandler.js";

/**
 * SQL-backed concrete `BaseMapiEmsmdbRoute`. See `MapiEmsmdbRouteMongo.ts`'s doc comment - the same mounting
 * pattern applies here.
 *
 * @author Jean-Philippe Steinmetz
 */
export class MapiEmsmdbRouteSQL extends BaseMapiEmsmdbRoute<MailboxSQL> {
    protected mailboxClass: any = MailboxSQL;
    protected folderClass: any = FolderSQL;
    protected messageClass: any = MessageSQL;
    protected ropHandlerClasses: any[] = [
        RopLogonHandler,
        RopReleaseHandler,
        RopOpenFolderHandler,
        RopGetHierarchyTableHandler,
        RopGetContentsTableHandler,
        RopSetColumnsHandler,
        RopQueryRowsHandler,
        RopOpenMessageHandler,
        RopGetPropertiesSpecificHandler,
        RopOpenStreamHandler,
        RopReadStreamHandler,
        RopCreateMessageHandler,
        RopSetPropertiesHandler,
        RopWriteStreamHandler,
        RopSaveChangesMessageHandler,
        RopSubmitMessageHandler,
    ];
}
