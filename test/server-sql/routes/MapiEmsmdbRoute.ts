import { RouteDecorators } from "@rapidrest/service-core";
import { MapiEmsmdbRouteSQL } from "../../../src/mapi/sql/MapiEmsmdbRouteSQL.js";
const { Route } = RouteDecorators;

@Route("/sql/mapi/emsmdb")
export class MapiEmsmdbRoute extends MapiEmsmdbRouteSQL {}
