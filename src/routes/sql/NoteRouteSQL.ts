///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { NoteSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(NoteSQL)
export class NoteRouteSQL extends CRUDRoute<NoteSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
