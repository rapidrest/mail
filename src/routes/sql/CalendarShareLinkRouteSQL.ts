///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { CalendarShareLinkSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(CalendarShareLinkSQL)
export class CalendarShareLinkRouteSQL extends CRUDRoute<CalendarShareLinkSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
