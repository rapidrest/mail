///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { FolderMongo, MessageMongo } from "../../mongo.js";
import { BaseMessageRoute } from "../BaseMessageRoute.js";
const { Model } = RouteDecorators;

@Model(MessageMongo)
export class MessageRouteMongo extends BaseMessageRoute<MessageMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
    protected folderClass: any = FolderMongo;
}
