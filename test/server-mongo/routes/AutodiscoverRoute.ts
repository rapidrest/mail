import { RouteDecorators } from "@rapidrest/service-core";
import { AutodiscoverRouteMongo } from "../../../src/autodiscover/mongo/AutodiscoverRouteMongo.js";
const { Route } = RouteDecorators;

@Route("/mongo/autodiscover")
export class AutodiscoverRoute extends AutodiscoverRouteMongo {
    protected readonly easUrl = "https://mail.example.com/Microsoft-Server-ActiveSync";
}
