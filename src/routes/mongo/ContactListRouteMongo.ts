///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { ContactListMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(ContactListMongo)
export class ContactListRouteMongo extends CRUDRoute<ContactListMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
