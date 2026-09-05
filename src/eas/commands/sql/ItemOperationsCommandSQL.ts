///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { MessageSQL, AttachmentSQL } from "../../../sql.js";
import { ItemOperationsCommand } from "../ItemOperationsCommand.js";

/**
 * @author Jean-Philippe Steinmetz
 */
export class ItemOperationsCommandSQL extends ItemOperationsCommand {
    protected messageClass: any = MessageSQL;
    protected attachmentClass: any = AttachmentSQL;
}
