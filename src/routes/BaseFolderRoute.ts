///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ApiError, type JWTUser } from "@rapidrest/core";
import {
    ACLAction,
    ApiErrorMessages,
    ApiErrors,
    CRUDRoute,
    HttpRequest,
    HttpResponse,
    RouteDecorators,
} from "@rapidrest/service-core";
import { Folder } from "../models/types.js";
const { Get, Head, Param, Post, Query, Request, Response, User: AuthUser } = RouteDecorators;

/**
 * Extends the standard `CRUDRoute` CRUD scaffolding for `Folder` with a hybrid permission model — `Folder` is
 * one of the two entities in this library with a real per-record `AccessControlList` (the other is `Mailbox`;
 * see the architecture note on `Message.mailboxUid` in `models/types.ts`), so most of `CRUDRoute`'s default
 * behavior already works correctly and is left untouched here:
 *
 * - `findById`/`update`/`delete`/`truncate` rely on `Folder`'s own record-level ACL, which by default inherits
 * (via `AccessControlList.parentUid`) from its owning `Mailbox`'s ACL — so anyone the mailbox is shared with
 * automatically gets the same access to its folders, while a single folder (e.g. one Calendar) can still be
 * shared more narrowly by adding records directly to *that folder's own* ACL instead. `RepoUtils.findOne()`/
 * `update()`/`delete()` check the record's own resolved ACL chain directly (no class-level fast-fail), so
 * this works correctly once the class-level grant is denied; `truncate()` skips its class-level check
 * entirely whenever `recordACL` is `true` (verified by reading its source) and relies on per-record
 * filtering instead, which is equally safe here for the same reason.
 * - `find`/`count`/`exists` are overridden here, for the same reason every other collection-or-fast-fail-gated
 * operation in this library is: `RepoUtils.find()`/`count()`/`exists()` all check the class-level ACL as an
 * unconditional first gate — before any per-record narrowing, and even that later narrowing falls back to
 * the class grant for a record with no caller-specific entry — so a per-record ACL alone can't safely narrow
 * them once class-level access is granted to anyone. `find`/`count` take an explicit `mailboxUid` query
 * parameter and check permission against it directly; `exists` fetches the specific folder first (bypassing
 * ACL) and then checks permission against *that folder's own* uid (i.e. its real resolved ACL chain), same
 * as `findById` does implicitly.
 * - `create` is also overridden, for a different reason: it seeds the new folder's ACL with `parentUid` set to
 * the owning mailbox's ACL uid, which is what wires up the inheritance described above — this can't be done
 * generically by `RepoUtils.create()`'s own default (it would parent to the `Folder` class ACL instead, which
 * is deny-all and grants nothing) — and, since a folder doesn't exist yet at create time, permission is
 * checked against the target `mailboxUid` from the request body instead.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseFolderRoute<T extends Folder> extends CRUDRoute<T> {
    @Head()
    public async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: HttpResponse,
        @AuthUser user?: JWTUser,
    ): Promise<any> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }
        const mailboxUid: string | undefined = query?.mailboxUid;
        if (!mailboxUid) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
        }
        if (!(await this.aclUtils!.hasPermission(user, mailboxUid, ACLAction.COUNT))) {
            return res.status(200).setHeader("content-length", 0);
        }
        const result: number = await this.repoUtils.count(
            { ...query, ...params },
            { limit: query?.limit, page: query?.page, version: query?.version, user, ignoreACL: true },
        );
        return res.status(200).setHeader("content-length", result);
    }

    @Post()
    public async create(
        obj: Partial<T> | Partial<T>[],
        @Request req: HttpRequest,
        @AuthUser user?: JWTUser,
    ): Promise<T | T[]> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }
        const objs: Partial<T>[] = Array.isArray(obj) ? obj : [obj];
        const results: T[] = [];
        for (const raw of objs) {
            const mailboxUid: string | undefined = raw.mailboxUid;
            if (!mailboxUid || !(await this.aclUtils!.hasPermission(user, mailboxUid, ACLAction.CREATE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
            const instance: T = this.repoUtils.instantiateObject(raw);
            const created: T = await this.repoUtils.create(instance, {
                user,
                ignoreACL: true,
                acl: { uid: instance.uid, parentUid: mailboxUid, records: [] },
            });
            results.push(created);
        }
        return Array.isArray(obj) ? results : results[0];
    }

    @Get()
    public async find(@Param() params: any, @Query() query: any, @AuthUser user?: JWTUser): Promise<T[]> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }
        const mailboxUid: string | undefined = query?.mailboxUid;
        if (!mailboxUid) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
        }
        if (!(await this.aclUtils!.hasPermission(user, mailboxUid, ACLAction.LIST))) {
            return [];
        }
        return await this.repoUtils.find(
            { ...query, ...params },
            { limit: query?.limit, page: query?.page, version: query?.version, user, ignoreACL: true },
        );
    }

    @Head("/:id")
    public async exists(
        @Param("id") id: string,
        @Query() query: any,
        @Response res: HttpResponse,
        @AuthUser user?: JWTUser,
    ): Promise<any> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }
        const existing: T | undefined = await this.repoUtils.findOne(id, {
            version: query?.version,
            includeDeleted: query?.deleted === true || query?.deleted === "true",
            ignoreACL: true,
        });
        const permitted: boolean = existing
            ? await this.aclUtils!.hasPermission(user, existing.uid, ACLAction.EXISTS)
            : false;
        return permitted
            ? res.status(200).setHeader("content-length", 1)
            : res.status(404).setHeader("content-length", 0);
    }
}
