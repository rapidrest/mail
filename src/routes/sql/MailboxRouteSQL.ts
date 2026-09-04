///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { MailboxSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(MailboxSQL)
export class MailboxRouteSQL extends CRUDRoute<MailboxSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
