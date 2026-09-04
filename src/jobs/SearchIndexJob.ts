///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { simpleParser, ParsedMail } from "mailparser";
import { ObjectDecorators } from "@rapidrest/core";
import { BackgroundService, ObjectFactory, RepoUtils } from "@rapidrest/service-core";
import { BlobStore } from "../blob/BlobStore.js";
import { SearchDocument, SearchProvider } from "../search/SearchProvider.js";
import { Attachment, Message } from "../models/types.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

/**
 * Reconciles `SearchProvider`'s index against `Message` records that haven't been indexed yet
 * (`Message.searchIndexedAt` is unset). This is what decouples "committed to the primary datastore" from
 * "visible in search" (see `SearchProvider`'s doc comment) — a just-ingested or just-sent message is readable
 * via the standard REST API immediately, and becomes findable via search within one run of this job.
 *
 * Scoped to `Message` search for the initial pragmatic subset, since full-text search over subject/body/
 * attachments was the explicit requirement driving this subsystem; indexing Contacts/CalendarEvents/Notes/
 * Tasks is a natural extension (the `SearchProvider`/`SearchDocument` interfaces already support it) but is
 * deliberately left for a later pass rather than built speculatively here.
 *
 * `AttachmentExtractionJob` clears `searchIndexedAt` back to `undefined` on a message whose attachment text
 * extraction completes *after* this job already indexed it once, so it gets picked up again with the newly
 * available attachment text.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class SearchIndexJob<M extends Message, A extends Attachment> extends BackgroundService {
    protected abstract messageClass: any;
    protected abstract attachmentClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private messageRepo?: RepoUtils<M>;
    private attachmentRepo?: RepoUtils<A>;

    @Inject("BlobStore")
    private blobStore?: BlobStore;

    @Inject("SearchProvider")
    private searchProvider?: SearchProvider;

    @Config("mail:jobs:search_index:schedule", "*/15 * * * * *")
    private scheduleExpr: string = "*/15 * * * * *";

    @Config("mail:jobs:search_index:batch_size", 50)
    private batchSize: number = 50;

    @Logger
    private logger: any;

    public get schedule(): string | undefined {
        return this.scheduleExpr;
    }

    @Init
    public async init(): Promise<void> {
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
        if (!this.messageRepo || !this.searchProvider || !this.blobStore) {
            return;
        }

        const pending: M[] = await this.messageRepo.find(
            { searchIndexedAt: null },
            { ignoreACL: true, limit: this.batchSize },
        );

        const docs: SearchDocument[] = [];
        for (const message of pending) {
            try {
                docs.push(await this.buildDocument(message));
            } catch (err: any) {
                this.logger?.warn(`SearchIndexJob: failed to build search document for message ${message.uid}: ${err.message}`);
            }
        }

        if (docs.length === 0) {
            return;
        }

        await this.searchProvider.bulkIndex(docs);

        const now: Date = new Date();
        for (const message of pending) {
            await this.messageRepo.update(
                { uid: message.uid, version: (message as any).version, searchIndexedAt: now } as any,
                message,
                { ignoreACL: true, skipPush: true },
            );
        }
    }

    private async buildDocument(message: M): Promise<SearchDocument> {
        const raw: Buffer = await this.blobStore!.get(message.bodyBlobKey);
        const parsed: ParsedMail = await simpleParser(raw);
        const body: string = typeof parsed.text === "string" ? parsed.text : (parsed.html || "").toString();

        const attachmentText: string[] = [];
        if (message.hasAttachments) {
            const attachments: A[] = await this.attachmentRepo!.find(
                { messageUid: message.uid },
                { ignoreACL: true },
            );
            for (const attachment of attachments) {
                if (attachment.extractedTextBlobKey) {
                    const text: Buffer = await this.blobStore!.get(attachment.extractedTextBlobKey);
                    attachmentText.push(text.toString("utf-8"));
                }
            }
        }

        const participants: string[] = [message.from.address, ...message.recipients.map((r) => r.address)];

        return {
            entityType: "message",
            entityUid: message.uid,
            mailboxUid: message.mailboxUid,
            subject: message.subject,
            body,
            attachmentText,
            participants,
            dateForSort: message.sentDate,
        };
    }
}
