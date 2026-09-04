///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { CalendarEventSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(CalendarEventSQL)
export class CalendarEventRouteSQL extends CRUDRoute<CalendarEventSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
