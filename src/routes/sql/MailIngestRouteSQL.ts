///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { IngestQueueEntrySQL, MailboxSQL } from "../../sql.js";
import { BaseMailIngestRoute } from "../BaseMailIngestRoute.js";

export class MailIngestRouteSQL extends BaseMailIngestRoute<MailboxSQL, IngestQueueEntrySQL> {
    protected mailboxClass: any = MailboxSQL;
    protected ingestQueueClass: any = IngestQueueEntrySQL;

    /**
     * `MailboxSQL.aliasAddresses` is a `simple-json` column, stored as a serialized JSON array string (e.g.
     * `["a@example.com","b@example.com"]`). A plain equality filter compares against that whole string, so it
     * never matches a single address. Match the serialized substring instead, anchored on the surrounding
     * quotes `getQueryParamValue`'s JSON encoding produces, so a partial-address match (e.g. "ob@example.co"
     * against a stored "bob@example.com") can't produce a false positive.
     */
    protected aliasQueryValue(address: string): any {
        return `like(%"${address}"%)`;
    }
}
