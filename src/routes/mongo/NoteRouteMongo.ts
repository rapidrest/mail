///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { NoteMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(NoteMongo)
export class NoteRouteMongo extends CRUDRoute<NoteMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
