///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { FolderSQL, MessageSQL } from "../../sql.js";
import { BaseMessageRoute } from "../BaseMessageRoute.js";
const { Model } = RouteDecorators;

@Model(MessageSQL)
export class MessageRouteSQL extends BaseMessageRoute<MessageSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
    protected folderClass: any = FolderSQL;
}
