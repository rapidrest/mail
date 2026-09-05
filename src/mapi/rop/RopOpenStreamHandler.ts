///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { BufferReader, BufferWriter } from "../codec/BufferCursor.js";
import { PropertyTag, PropertyType, readPropertyTag } from "../codec/PropertyValue.js";
import { PID_TAG_BODY, resolveMessageBodyBytes } from "./MessageBodyStream.js";
import type { RopContext, RopHandler } from "./RopHandler.js";

const ROP_ID_OPEN_STREAM = 0x2b;

/** The well-known MAPI HRESULT `MAPI_E_NOT_FOUND`, reused for "the referenced handle isn't a message, or the
 * requested property isn't one this pragmatic subset can stream" - the same constant `RopOpenFolderHandler`
 * uses for its own analogous lookup-miss case. */
const ERROR_NOT_FOUND = 0x8004010f;

/**
 * `RopOpenStream` (`[MS-OXCPRPT]`/`[MS-OXCROPS]`): opens a property for streaming access, producing a new
 * `"stream"` Server object handle `RopReadStream` reads from by `InputHandleIndex`. **Pragmatic subset**: only
 * `PidTagBody` (`PtypString`, the plain-text message body) on an already-open `"message"` handle is supported
 * - a real client also streams `PidTagHtml`/`PidTagRtfCompressed` (rich body formats) and folder/attachment
 * binary properties, none of which this pass implements; requesting any other `PropertyTag`, or opening a
 * stream against a non-message handle, fails with `MAPI_E_NOT_FOUND` rather than succeeding with wrong data.
 *
 * `OpenModeFlags` (`ReadOnly`/`ReadWrite`/`Create`, `[MS-OXCPRPT]` §2.2.14.1) is decoded to advance past it
 * correctly but not honored - this pragmatic subset only ever opens a stream for reading, since
 * `RopWriteStream`/`RopCommitStream` aren't implemented yet.
 *
 * @author Jean-Philippe Steinmetz
 */
export class RopOpenStreamHandler implements RopHandler {
    public readonly ropId = ROP_ID_OPEN_STREAM;

    public async handle(reader: BufferReader, writer: BufferWriter, context: RopContext): Promise<void> {
        reader.readUInt8(); // LogonId - this pragmatic subset doesn't track multiple concurrent logons per session
        const inputHandleIndex: number = reader.readUInt8();
        const outputHandleIndex: number = reader.readUInt8();
        const propertyTag: PropertyTag = readPropertyTag(reader);
        reader.readUInt8(); // OpenModeFlags - read-only opens only in this pragmatic subset

        const handle = context.session.handles[inputHandleIndex];
        const isSupportedProperty = propertyTag.propertyId === PID_TAG_BODY && propertyTag.propertyType === PropertyType.PtypString;
        if (!handle || handle.type !== "message" || !isSupportedProperty) {
            writer.writeUInt8(ROP_ID_OPEN_STREAM);
            writer.writeUInt8(outputHandleIndex);
            writer.writeUInt32LE(ERROR_NOT_FOUND);
            return;
        }

        const bytes = await resolveMessageBodyBytes(handle.entityUid, context.messageRepo, context.blobStore);
        context.session.handles[outputHandleIndex] = {
            type: "stream",
            entityUid: handle.entityUid,
            propertyId: propertyTag.propertyId,
            propertyType: propertyTag.propertyType,
            streamPosition: 0,
        };

        writer.writeUInt8(ROP_ID_OPEN_STREAM);
        writer.writeUInt8(outputHandleIndex);
        writer.writeUInt32LE(0); // ReturnValue - success
        writer.writeUInt32LE(bytes.length); // StreamSize
    }
}
