///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { CalendarEventMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(CalendarEventMongo)
export class CalendarEventRouteMongo extends CRUDRoute<CalendarEventMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
