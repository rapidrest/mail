///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CalendarEventSQL, CalendarShareLinkSQL } from "../../sql.js";
import { BaseCalendarFreeBusyRoute } from "../BaseCalendarFreeBusyRoute.js";

export class CalendarFreeBusyRouteSQL extends BaseCalendarFreeBusyRoute<CalendarShareLinkSQL, CalendarEventSQL> {
    protected shareLinkClass: any = CalendarShareLinkSQL;
    protected calendarEventClass: any = CalendarEventSQL;
}
