///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { MailboxMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(MailboxMongo)
export class MailboxRouteMongo extends CRUDRoute<MailboxMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
