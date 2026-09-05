///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { MailboxMongo } from "../../mongo.js";
import { BaseAutodiscoverRoute } from "../BaseAutodiscoverRoute.js";

/**
 * Mongo-backed concrete `BaseAutodiscoverRoute`. `easUrl` remains abstract - the deployment's own
 * `@Route("/autodiscover")` subclass supplies it. See `EasRouteMongo.ts`'s doc comment for the identical
 * mounting pattern.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class AutodiscoverRouteMongo extends BaseAutodiscoverRoute<MailboxMongo> {
    protected mailboxClass: any = MailboxMongo;
}
