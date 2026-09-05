///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { MailboxSQL } from "../../sql.js";
import { BaseMailboxRoute } from "../BaseMailboxRoute.js";
const { Model } = RouteDecorators;

@Model(MailboxSQL)
export class MailboxRouteSQL extends BaseMailboxRoute<MailboxSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
