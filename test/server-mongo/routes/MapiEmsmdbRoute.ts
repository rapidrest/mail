import { RouteDecorators } from "@rapidrest/service-core";
import { MapiEmsmdbRouteMongo } from "../../../src/mapi/mongo/MapiEmsmdbRouteMongo.js";
const { Route } = RouteDecorators;

@Route("/mongo/mapi/emsmdb")
export class MapiEmsmdbRoute extends MapiEmsmdbRouteMongo {}
