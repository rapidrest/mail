///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { MailboxMongo } from "../../mongo.js";
import { BaseMapiEmsmdbRoute } from "../BaseMapiEmsmdbRoute.js";

/**
 * Mongo-backed concrete `BaseMapiEmsmdbRoute`. A deployment mounts this at the well-known MAPI/HTTP path via
 * its own trivial `@Route("/mapi/emsmdb")` subclass, following the same pattern `EasRouteMongo.ts`'s doc
 * comment describes.
 *
 * @author Jean-Philippe Steinmetz
 */
export class MapiEmsmdbRouteMongo extends BaseMapiEmsmdbRoute<MailboxMongo> {
    protected mailboxClass: any = MailboxMongo;
}
