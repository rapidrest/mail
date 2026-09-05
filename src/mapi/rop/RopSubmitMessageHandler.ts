///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { findOrCreateWellKnownFolder } from "../../util/FolderUtils.js";
import { scanAndRelay } from "../../util/MailSendUtils.js";
import { FolderType, MessageImportance, RecipientType } from "../../models/types.js";
import type { BufferReader, BufferWriter } from "../codec/BufferCursor.js";
import type { RopContext, RopHandler } from "./RopHandler.js";

const ROP_ID_SUBMIT_MESSAGE = 0x32;

/** The well-known MAPI HRESULT `MAPI_E_INVALID_OBJECT`, reused for both "the referenced handle isn't a draft
 * message" and "the draft has no resolvable recipients/sender" - the same constant reused throughout this
 * pragmatic subset as a generic "can't do this" signal, not a claim of exact per-condition `[MS-OXCRPC]`
 * return-value-table parity. */
const ERROR_INVALID_OBJECT = 0x80070005;

// The same well-known property IDs RopSetPropertiesHandler tracks - duplicated here (rather than imported)
// since importing them would only save a handful of literals; see that file for the real documentation of what
// each means.
const PID_TAG_SUBJECT = 0x0037;
const PID_TAG_DISPLAY_BCC = 0x0e02;
const PID_TAG_DISPLAY_CC = 0x0e03;
const PID_TAG_DISPLAY_TO = 0x0e04;
const PID_TAG_BODY = 0x1000;

/** Splits a `PidTagDisplayTo`/`Cc`/`Bcc`-style string on the semicolons real Outlook separates recipients
 * with (also tolerating commas, in case a client or test harness uses that convention instead), trimming and
 * dropping empty entries. */
function parseAddressList(value: string | undefined): string[] {
    if (!value) {
        return [];
    }
    return value
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * `RopSubmitMessage` (`[MS-OXOMSG]`/`[MS-OXCROPS]`): sends a composed message - the actual trigger point for
 * this pragmatic subset's compose/send pipeline, since `RopSaveChangesMessage` itself does no real persistence
 * (see its own doc comment). Builds a raw MIME buffer from whatever `RopSetProperties`/`RopWriteStream` calls
 * accumulated on the draft handle (`Subject`, the `PidTagBody` stream or an inline `PidTagBody` property, and
 * addressing - see below), via `nodemailer`'s `MailComposer` (already a dependency, used elsewhere in this
 * library only to *send*, not build, MIME - this is its first use purely as a RFC 5322 serializer), then calls
 * the exact same `scanAndRelay()` scan-then-relay pipeline `BaseMessageRoute.send()`/EAS's `ComposeMailCommand`
 * already share, and persists a Sent Items copy (mirroring `ComposeMailCommand`'s own always-committed Sent
 * Items behavior for MAPI submission specifically, since - unlike EAS's optional `SaveInSentItems` - a MAPI
 * `RopSubmitMessage` call has no "don't keep a copy" option to honor).
 *
 * **Known, deliberate limitation - no `RopModifyRecipients` support**: real recipient rows (`[MS-OXCMSG]`
 * §2.2.3.2, each with its own `PidTagEmailAddress`/`PidTagRecipientType`) are a substantial structure this
 * pragmatic subset's ROP coverage doesn't include. Instead, addressing is read from `PidTagDisplayTo`/
 * `DisplayCc`/`DisplayBcc` - the same semicolon-separated "cached recipient display string" properties real
 * Outlook *also* always sets via `RopSetProperties` alongside `RopModifyRecipients` (as a display-only
 * convenience cache). This works correctly for the common case of composing to bare, unresolved email
 * addresses (nothing to resolve to a distinct display name) - the case this library's own integration tests
 * exercise - but is **not** a substitute for real recipient rows: a client that resolves typed names against an
 * address book before submitting would populate these fields with display names, not addresses, and this
 * pragmatic subset has no way to recover a real SMTP address from a bare display name. Documented here rather
 * than silently producing wrong addressing.
 *
 * `SubmitFlags` (`PreprocessOnly`, ...) is decoded to advance past it correctly but not honored - this
 * pragmatic subset has no transport-agent preprocessing distinction to vary by flag.
 *
 * @author Jean-Philippe Steinmetz
 */
export class RopSubmitMessageHandler implements RopHandler {
    public readonly ropId = ROP_ID_SUBMIT_MESSAGE;

    public async handle(reader: BufferReader, writer: BufferWriter, context: RopContext): Promise<void> {
        reader.readUInt8(); // LogonId - this pragmatic subset doesn't track multiple concurrent logons per session
        const inputHandleIndex: number = reader.readUInt8();
        reader.readUInt8(); // SubmitFlags - see class doc comment

        const handle = context.session.handles[inputHandleIndex];
        if (!handle || handle.type !== "message") {
            writer.writeUInt8(ROP_ID_SUBMIT_MESSAGE);
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt32LE(ERROR_INVALID_OBJECT);
            return;
        }

        const properties = handle.draftProperties ?? {};
        const to = parseAddressList(properties[String(PID_TAG_DISPLAY_TO)]);
        const cc = parseAddressList(properties[String(PID_TAG_DISPLAY_CC)]);
        const bcc = parseAddressList(properties[String(PID_TAG_DISPLAY_BCC)]);
        const mailbox = await context.mailboxRepo.findOne(context.mailboxUid, { ignoreACL: true });
        const envelopeFrom: string | undefined = mailbox?.primarySmtpAddress;

        if (!envelopeFrom || to.length + cc.length + bcc.length === 0) {
            writer.writeUInt8(ROP_ID_SUBMIT_MESSAGE);
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt32LE(ERROR_INVALID_OBJECT);
            return;
        }

        const subject = properties[String(PID_TAG_SUBJECT)] ?? "";
        const bodyText = resolveDraftBody(context, inputHandleIndex, properties);

        const raw: Buffer = await new MailComposer({ from: envelopeFrom, to, cc, bcc, subject, text: bodyText }).compile().build();
        const envelopeTo = [...to, ...cc, ...bcc];
        const { sanitizedHtmlBlobKey } = await scanAndRelay(raw, envelopeFrom, envelopeTo, context.scanPipeline, context.mailTransport, context.blobStore);

        const bodyBlobKey = `bodies/${crypto.randomUUID()}`;
        await context.blobStore.put(bodyBlobKey, raw, { contentType: "message/rfc822" });
        const sentFolder = await findOrCreateWellKnownFolder(context.folderRepo, context.folderClass, context.mailboxUid, FolderType.SENT_ITEMS);
        await context.messageRepo.create(
            new context.messageClass({
                folderUid: sentFolder.uid,
                mailboxUid: context.mailboxUid,
                messageId: `${crypto.randomUUID()}@mapi`,
                subject,
                from: { address: envelopeFrom, type: RecipientType.TO },
                recipients: [
                    ...to.map((address) => ({ address, type: RecipientType.TO })),
                    ...cc.map((address) => ({ address, type: RecipientType.CC })),
                    ...bcc.map((address) => ({ address, type: RecipientType.BCC })),
                ],
                sentDate: new Date(),
                receivedDate: new Date(),
                bodyBlobKey,
                sanitizedHtmlBlobKey,
                bodyPreview: bodyText.slice(0, 200),
                flags: { read: true, flagged: false, answered: false, forwarded: false },
                importance: MessageImportance.NORMAL,
                references: [],
                hasAttachments: false,
            }),
            { ignoreACL: true },
        );

        writer.writeUInt8(ROP_ID_SUBMIT_MESSAGE);
        writer.writeUInt8(inputHandleIndex);
        writer.writeUInt32LE(0); // ReturnValue - success
    }
}

/** Prefers a `RopWriteStream`-accumulated body (the real path a large body takes) over an inline `PidTagBody`
 * set directly via `RopSetProperties` (only realistic for a short body small enough to set inline) - see
 * `RopOpenStreamHandler`'s write-mode branch for how `writeTargetHandleIndex` links a stream handle back to the
 * draft message handle it was opened against. */
function resolveDraftBody(context: RopContext, messageHandleIndex: number, properties: Record<string, string>): string {
    for (const candidate of Object.values(context.session.handles)) {
        if (candidate.type === "stream" && candidate.writeTargetHandleIndex === messageHandleIndex && candidate.writeBufferBase64) {
            const raw = Buffer.from(candidate.writeBufferBase64, "base64");
            return raw.toString("utf16le").replace(/\0+$/, "");
        }
    }
    return properties[String(PID_TAG_BODY)] ?? "";
}
