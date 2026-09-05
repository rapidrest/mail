import { RouteDecorators } from "@rapidrest/service-core";
import { EasRouteMongo } from "../../../src/eas/mongo/EasRouteMongo.js";
const { Route } = RouteDecorators;

@Route("/mongo/eas")
export class EasRoute extends EasRouteMongo {}
