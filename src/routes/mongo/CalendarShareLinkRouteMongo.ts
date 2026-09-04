///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { CalendarShareLinkMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(CalendarShareLinkMongo)
export class CalendarShareLinkRouteMongo extends CRUDRoute<CalendarShareLinkMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
