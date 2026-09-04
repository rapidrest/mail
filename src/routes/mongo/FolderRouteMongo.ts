///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { FolderMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(FolderMongo)
export class FolderRouteMongo extends CRUDRoute<FolderMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
