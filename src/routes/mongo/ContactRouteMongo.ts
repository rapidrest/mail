///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { CRUDRoute, RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { ContactMongo } from "../../mongo.js";
const { Model } = RouteDecorators;

@Model(ContactMongo)
export class ContactRouteMongo extends CRUDRoute<ContactMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
