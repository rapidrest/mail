import { RouteDecorators } from "@rapidrest/service-core";
import { CalendarFreeBusyRouteMongo } from "../../../src/routes/mongo/CalendarFreeBusyRouteMongo.js";
const { Route } = RouteDecorators;

@Route("/mongo/calendar-freebusy")
export class CalendarFreeBusyRoute extends CalendarFreeBusyRouteMongo {}
