///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { MailboxMongo } from "../../mongo.js";
import { BaseMailboxRoute } from "../BaseMailboxRoute.js";
const { Model } = RouteDecorators;

@Model(MailboxMongo)
export class MailboxRouteMongo extends BaseMailboxRoute<MailboxMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
