///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { FolderSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(FolderSQL)
export class FolderRouteSQL extends CRUDRoute<FolderSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
