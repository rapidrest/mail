///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ApiError, ObjectDecorators, type JWTUser } from "@rapidrest/core";
import {
    ApiErrorMessages,
    ApiErrors,
    CRUDRoute,
    DocDecorators,
    HttpRequest,
    RepoUtils,
    RouteDecorators,
} from "@rapidrest/service-core";
import { BlobStore } from "../blob/BlobStore.js";
import { resolveDeliveryVerdict, ScanPipeline } from "../scan/ScanPipeline.js";
import { findOrCreateWellKnownFolder } from "../util/FolderUtils.js";
import { FolderType, Message, MessageFlags } from "../models/types.js";
const { Inject } = ObjectDecorators;
const { Description, Returns, Summary } = DocDecorators;
const { Param, Post, Request, User: AuthUser } = RouteDecorators;

/**
 * Extends the standard `CRUDRoute` CRUD scaffolding for `Message` with a `send` endpoint that composes,
 * (re-)scans, and relays a drafted message via `MailTransport`, then moves it into the mailbox's Sent Items
 * folder. Ordinary `create`/`update`/`delete`/`find`/`findById` (save-draft, edit-draft, discard-draft, list,
 * fetch) are handled entirely by `CRUDRoute` with no overrides needed — this is the only mail-specific
 * behavior a `Message` needs beyond plain CRUD.
 *
 * `folderClass` is supplied by the Mongo/SQL concrete subclasses so this class can look up (and, if needed,
 * create) the mailbox's Sent Items folder without depending on either backend directly.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseMessageRoute<T extends Message> extends CRUDRoute<T> {
    protected abstract folderClass: any;

    private folderRepo?: RepoUtils<any>;

    @Inject("BlobStore")
    private blobStore?: BlobStore;

    @Inject("MailTransport")
    private mailTransport?: any;

    @Inject(ScanPipeline)
    private scanPipeline?: ScanPipeline;

    private async getFolderRepo(): Promise<RepoUtils<any>> {
        if (!this.folderRepo) {
            this.folderRepo = await this._objectFactory!.newInstance(RepoUtils, {
                name: this.folderClass.name,
                args: [this.folderClass],
            });
        }
        return this.folderRepo;
    }

    @Summary("Send message")
    @Description(
        "Scans and relays a drafted message via the configured MailTransport, then moves it into the " +
            "mailbox's Sent Items folder.",
    )
    @Returns([Object])
    @Post("/:id/send")
    public async send(@Param("id") id: string, @Request req: HttpRequest, @AuthUser user?: JWTUser): Promise<T> {
        if (!this.repoUtils || !this.blobStore || !this.mailTransport || !this.scanPipeline) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const message: T | undefined = await this.repoUtils.findOne(id, { user });
        if (!message) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }

        // The message's `bodyBlobKey` already holds the fully composed RFC 5322 source (assembled by the
        // webmail compose UI, or an EAS/MAPI "send" handler, before this endpoint is called) — this route's
        // job is scanning and relay, not MIME composition.
        const raw: Buffer = await this.blobStore.get(message.bodyBlobKey);
        const envelopeTo: string[] = message.recipients.map((r) => r.address);

        const scanResult = await this.scanPipeline.run(raw, { from: message.from.address, to: envelopeTo });
        const verdict = resolveDeliveryVerdict(scanResult);
        if (verdict !== "deliver") {
            throw new ApiError(
                ApiErrors.INVALID_REQUEST,
                422,
                "This message could not be sent because it failed spam/malware scanning.",
            );
        }

        const transportResult = await this.mailTransport.send({
            raw,
            envelopeFrom: message.from.address,
            envelopeTo,
        });
        if (transportResult.accepted.length === 0) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 502, "The mail transport rejected this message.");
        }

        const folderRepo: RepoUtils<any> = await this.getFolderRepo();
        const sentFolder: any = await findOrCreateWellKnownFolder(
            folderRepo,
            this.folderClass,
            message.mailboxUid,
            FolderType.SENT_ITEMS,
            user,
        );
        const flags: MessageFlags = { ...message.flags, read: true };

        return await this.repoUtils.update(
            { uid: message.uid, version: (message as any).version, folderUid: sentFolder.uid, flags } as any,
            message,
            { user },
        );
    }
}
