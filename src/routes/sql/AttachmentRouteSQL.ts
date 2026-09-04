///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { AttachmentSQL } from "../../sql.js";
import { BaseAttachmentRoute } from "../BaseAttachmentRoute.js";
const { Model } = RouteDecorators;

@Model(AttachmentSQL)
export class AttachmentRouteSQL extends BaseAttachmentRoute<AttachmentSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
}
