///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CalendarEventMongo, CalendarShareLinkMongo } from "../../mongo.js";
import { BaseCalendarFreeBusyRoute } from "../BaseCalendarFreeBusyRoute.js";

export class CalendarFreeBusyRouteMongo extends BaseCalendarFreeBusyRoute<CalendarShareLinkMongo, CalendarEventMongo> {
    protected shareLinkClass: any = CalendarShareLinkMongo;
    protected calendarEventClass: any = CalendarEventMongo;
}
