///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { IngestQueueEntrySQL, MailboxSQL } from "../../sql.js";
import { BaseMailIngestRoute } from "../BaseMailIngestRoute.js";

export class MailIngestRouteSQL extends BaseMailIngestRoute<MailboxSQL, IngestQueueEntrySQL> {
    protected mailboxClass: any = MailboxSQL;
    protected ingestQueueClass: any = IngestQueueEntrySQL;
}
