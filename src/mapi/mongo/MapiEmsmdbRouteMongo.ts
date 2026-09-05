///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { FolderMongo, MailboxMongo, MessageMongo } from "../../mongo.js";
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

/**
 * Mongo-backed concrete `BaseMapiEmsmdbRoute`. A deployment mounts this at the well-known MAPI/HTTP path via
 * its own trivial `@Route("/mapi/emsmdb")` subclass, following the same pattern `EasRouteMongo.ts`'s doc
 * comment describes.
 *
 * @author Jean-Philippe Steinmetz
 */
export class MapiEmsmdbRouteMongo extends BaseMapiEmsmdbRoute<MailboxMongo> {
    protected mailboxClass: any = MailboxMongo;
    protected folderClass: any = FolderMongo;
    protected messageClass: any = MessageMongo;
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
    ];
}
