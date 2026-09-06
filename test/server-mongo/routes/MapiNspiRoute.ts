import { RouteDecorators } from "@rapidrest/service-core";
import { MapiNspiRouteMongo } from "../../../src/mapi/mongo/MapiNspiRouteMongo.js";
const { Route } = RouteDecorators;

@Route("/mongo/mapi/nspi")
export class MapiNspiRoute extends MapiNspiRouteMongo {}
