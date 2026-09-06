import { RouteDecorators } from "@rapidrest/service-core";
import { MapiNspiRouteSQL } from "../../../src/mapi/sql/MapiNspiRouteSQL.js";
const { Route } = RouteDecorators;

@Route("/sql/mapi/nspi")
export class MapiNspiRoute extends MapiNspiRouteSQL {}
