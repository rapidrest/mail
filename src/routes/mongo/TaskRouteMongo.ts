///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { TaskMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(TaskMongo)
export class TaskRouteMongo extends CRUDRoute<TaskMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
