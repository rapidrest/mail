///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { ContactSQL } from "../../sql.js";
const { Model } = RouteDecorators;

@Model(ContactSQL)
export class ContactRouteSQL extends CRUDRoute<ContactSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
