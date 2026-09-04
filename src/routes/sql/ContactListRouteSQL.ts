///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { ContactListSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(ContactListSQL)
export class ContactListRouteSQL extends CRUDRoute<ContactListSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
