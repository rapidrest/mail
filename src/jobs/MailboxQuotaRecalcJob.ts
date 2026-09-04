///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { BackgroundService, ObjectFactory, RepoUtils } from "@rapidrest/service-core";
import { BlobStore } from "../blob/BlobStore.js";
import { Attachment, Mailbox, Message } from "../models/types.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

/**
 * Periodically recomputes `Mailbox.usedBytes` from the mailbox's actual stored content (message body blobs plus
 * attachment content) and corrects any drift from the incremental updates other code paths (ingest, delete,
 * etc.) are expected to apply on their own. This job is a safety net against drift, not the primary mechanism
 * for keeping `usedBytes` accurate — it runs cheaply and idempotently, and only writes when the recomputed value
 * actually differs from what's stored.
 *
 * Concrete entity classes are supplied by the Mongo/SQL subclasses (`MailboxQuotaRecalcJobMongo`/
 * `MailboxQuotaRecalcJobSQL`), following the same multi-entity-type generic pattern `ScanQueueJob` uses.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class MailboxQuotaRecalcJob<MB extends Mailbox, M extends Message, A extends Attachment> extends BackgroundService {
    protected abstract mailboxClass: any;
    protected abstract messageClass: any;
    protected abstract attachmentClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private mailboxRepo?: RepoUtils<MB>;
    private messageRepo?: RepoUtils<M>;
    private attachmentRepo?: RepoUtils<A>;

    @Inject("BlobStore")
    private blobStore?: BlobStore;

    @Config("mail:jobs:mailbox_quota_recalc:schedule", "0 0 * * * *")
    private scheduleExpr: string = "0 0 * * * *";

    @Config("mail:jobs:mailbox_quota_recalc:batch_size", 100)
    private batchSize: number = 100;

    @Logger
    private logger: any;

    public get schedule(): string | undefined {
        return this.scheduleExpr;
    }

    @Init
    public async init(): Promise<void> {
        this.mailboxRepo = await this._objectFactory!.newInstance(RepoUtils, {
            name: this.mailboxClass.name,
            args: [this.mailboxClass],
        });
        this.messageRepo = await this._objectFactory!.newInstance(RepoUtils, {
            name: this.messageClass.name,
            args: [this.messageClass],
        });
        this.attachmentRepo = await this._objectFactory!.newInstance(RepoUtils, {
            name: this.attachmentClass.name,
            args: [this.attachmentClass],
        });
    }

    public async start(): Promise<void> {
        // Nothing to do at startup beyond `init()` above; processing happens entirely in `run()`.
    }

    public stop(): Promise<void> | void {
        // Do nothing
    }

    public async run(): Promise<void> {
        if (!this.mailboxRepo || !this.messageRepo || !this.attachmentRepo || !this.blobStore) {
            return;
        }

        // No obvious "least-recently-recalculated" field exists on `Mailbox` to sort by, so this simply
        // processes the first page each run - acceptable since this is cheap, idempotent drift-correction, not
        // correctness-critical delivery.
        const mailboxes: MB[] = await this.mailboxRepo.find({}, { ignoreACL: true, limit: this.batchSize });

        for (const mailbox of mailboxes) {
            try {
                await this.recalcMailbox(mailbox);
            } catch (err: any) {
                this.logger?.error(
                    `MailboxQuotaRecalcJob: failed to recalculate usedBytes for mailbox ${mailbox.uid}: ${err.message}`,
                );
            }
        }
    }

    private async recalcMailbox(mailbox: MB): Promise<void> {
        const messages: M[] = await this.messageRepo!.find({ mailboxUid: mailbox.uid }, { ignoreACL: true });

        let usedBytes = 0;
        for (const message of messages) {
            try {
                usedBytes += await this.blobStore!.size(message.bodyBlobKey);
            } catch (err: any) {
                this.logger?.warn(
                    `MailboxQuotaRecalcJob: failed to size body blob ${message.bodyBlobKey} for message ${message.uid}, treating as 0 bytes: ${err.message}`,
                );
            }

            if (message.hasAttachments) {
                const attachments: A[] = await this.attachmentRepo!.find(
                    { messageUid: message.uid },
                    { ignoreACL: true },
                );
                for (const attachment of attachments) {
                    usedBytes += attachment.sizeBytes;
                }
            }
        }

        // Skip the write entirely when nothing has drifted - this job runs frequently and most mailboxes won't
        // have drifted, so avoiding a no-op update() call (and the version bump/push it would trigger) matters.
        if (usedBytes !== mailbox.usedBytes) {
            await this.mailboxRepo!.update(
                { uid: mailbox.uid, version: (mailbox as any).version, usedBytes } as any,
                mailbox,
                { ignoreACL: true, skipPush: true },
            );
        }
    }
}
