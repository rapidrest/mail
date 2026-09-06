import { RouteDecorators } from "@rapidrest/service-core";
import { AutodiscoverRouteSQL } from "../../../src/autodiscover/sql/AutodiscoverRouteSQL.js";
const { Route } = RouteDecorators;

@Route("/sql/autodiscover")
export class AutodiscoverRoute extends AutodiscoverRouteSQL {
    protected readonly easUrl = "https://mail.example.com/Microsoft-Server-ActiveSync";
    protected readonly mapiUrl = "https://mail.example.com/mapi/emsmdb";
}
