import { RouteDecorators } from "@rapidrest/service-core";
import { CalendarFreeBusyRouteSQL } from "../../../src/routes/sql/CalendarFreeBusyRouteSQL.js";
const { Route } = RouteDecorators;

@Route("/sql/calendar-freebusy")
export class CalendarFreeBusyRoute extends CalendarFreeBusyRouteSQL {}
