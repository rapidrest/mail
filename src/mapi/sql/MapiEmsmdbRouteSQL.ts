///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { MailboxSQL } from "../../sql.js";
import { BaseMapiEmsmdbRoute } from "../BaseMapiEmsmdbRoute.js";

/**
 * SQL-backed concrete `BaseMapiEmsmdbRoute`. See `MapiEmsmdbRouteMongo.ts`'s doc comment - the same mounting
 * pattern applies here.
 *
 * @author Jean-Philippe Steinmetz
 */
export class MapiEmsmdbRouteSQL extends BaseMapiEmsmdbRoute<MailboxSQL> {
    protected mailboxClass: any = MailboxSQL;
}
