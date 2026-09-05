///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { BufferReader, BufferWriter } from "../codec/BufferCursor.js";
import { assignOrGetMid } from "./MessageTarget.js";
import type { RopContext, RopHandler } from "./RopHandler.js";

const ROP_ID_SAVE_CHANGES_MESSAGE = 0x0c;

/** The well-known MAPI HRESULT `MAPI_E_INVALID_OBJECT`, reused for "the referenced handle isn't a message (or
 * doesn't exist)" - the same constant `RopGetPropertiesSpecificHandler` uses for its own analogous check. */
const ERROR_INVALID_OBJECT = 0x80070005;

/**
 * `RopSaveChangesMessage` (`[MS-OXCMSG]`/`[MS-OXCROPS]`): persists a message's pending changes, returning the
 * `MID` a client can reference it by afterwards. **Pragmatic subset**: this library has no separate Drafts-
 * folder persistence step (matching EAS's own `ComposeMailCommand`, which never creates a standalone draft
 * `Message` row either) - saving a `RopCreateMessage` draft does not yet write anything to a database. It only
 * assigns a session-scoped MID (`MessageTarget.assignOrGetMid`, the exact mechanism a `RopQueryRows` row's
 * `PidTagMid` column already uses) so the wire contract's `MessageId` field is well-formed, keyed by this
 * handle's own index (`` `draft:${inputHandleIndex}` ``) since an unsaved draft has no real `"message:<uid>"`
 * target yet. The real work - actually building and sending a MIME message from the properties/body
 * accumulated so far - happens at `RopSubmitMessage` time, not here; calling Save without ever calling Submit
 * silently discards the draft when the session expires, a real, deliberate limitation (this pragmatic subset
 * has no autosave-recovery story) rather than a silently-wrong one.
 *
 * Re-saving an already-real message (a `RopOpenMessage` handle, not a fresh `RopCreateMessage` draft) is
 * accepted but is a no-op beyond echoing that message's own already-assigned MID - editing an existing
 * message's properties is out of scope for this pragmatic subset's compose/send-only ROP coverage.
 *
 * `SaveFlags` is decoded to advance past it correctly but not honored - this pragmatic subset has no
 * conflict-resolution/force-save semantics to vary by flag.
 *
 * @author Jean-Philippe Steinmetz
 */
export class RopSaveChangesMessageHandler implements RopHandler {
    public readonly ropId = ROP_ID_SAVE_CHANGES_MESSAGE;

    public handle(reader: BufferReader, writer: BufferWriter, context: RopContext): void {
        reader.readUInt8(); // LogonId - this pragmatic subset doesn't track multiple concurrent logons per session
        const responseHandleIndex: number = reader.readUInt8();
        const inputHandleIndex: number = reader.readUInt8();
        reader.readUInt8(); // SaveFlags - see class doc comment

        const handle = context.session.handles[inputHandleIndex];
        if (!handle || handle.type !== "message") {
            writer.writeUInt8(ROP_ID_SAVE_CHANGES_MESSAGE);
            writer.writeUInt8(responseHandleIndex);
            writer.writeUInt32LE(ERROR_INVALID_OBJECT);
            return;
        }

        const targetKey = handle.entityUid !== "" ? handle.entityUid : `draft:${inputHandleIndex}`;
        const mid = BigInt(assignOrGetMid(context.session, targetKey));

        writer.writeUInt8(ROP_ID_SAVE_CHANGES_MESSAGE);
        writer.writeUInt8(responseHandleIndex);
        writer.writeUInt32LE(0); // ReturnValue - success
        writer.writeUInt8(inputHandleIndex);
        writer.writeBigUInt64LE(mid);
    }
}
