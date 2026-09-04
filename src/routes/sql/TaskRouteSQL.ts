///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { TaskSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(TaskSQL)
export class TaskRouteSQL extends CRUDRoute<TaskSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
