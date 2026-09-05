///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { BufferReader, BufferWriter } from "../codec/BufferCursor.js";
import { PropertyType, readTaggedPropertyValue, type TaggedPropertyValue } from "../codec/PropertyValue.js";
import type { RopContext, RopHandler } from "./RopHandler.js";

const ROP_ID_SET_PROPERTIES = 0x0a;

/** The well-known MAPI HRESULT `MAPI_E_INVALID_OBJECT`, reused for "the referenced handle isn't a message (or
 * doesn't exist)" - the same constant `RopGetPropertiesSpecificHandler` uses for its own analogous check.
 * `RopSetProperties` is also spec-valid on Folder/Attachment/Logon objects, none of which this pragmatic
 * subset's compose/send path ever needs to set properties on. */
const ERROR_INVALID_OBJECT = 0x80070005;

// The small, well-known set of properties this pragmatic subset's compose/send path tracks - exactly what
// RopSubmitMessageHandler needs to build a MIME message (Subject, an inline small body, and the
// PidTagDisplayTo/Cc/Bcc "cached recipient display string" properties real Outlook also always sets alongside
// RopModifyRecipients - see RopSubmitMessageHandler's own doc comment for why this pragmatic subset reads
// addresses from these instead of implementing RopModifyRecipients). Every other property a client sets is
// accepted (this ROP always reports success, no PropertyProblems) but simply not tracked - harmless for this
// pragmatic subset's narrow compose/send scope.
const PID_TAG_SUBJECT = 0x0037;
const PID_TAG_DISPLAY_BCC = 0x0e02;
const PID_TAG_DISPLAY_CC = 0x0e03;
const PID_TAG_DISPLAY_TO = 0x0e04;
const PID_TAG_BODY = 0x1000;
const TRACKED_PROPERTY_IDS: ReadonlySet<number> = new Set([PID_TAG_SUBJECT, PID_TAG_DISPLAY_BCC, PID_TAG_DISPLAY_CC, PID_TAG_DISPLAY_TO, PID_TAG_BODY]);

/**
 * `RopSetProperties` (`[MS-OXCPRPT]`/`[MS-OXCROPS]`): sets an explicit, client-chosen list of properties
 * (`TaggedPropertyValue`s, each carrying its own `PropertyTag`) on an already-open object. This pragmatic
 * subset supports only `"message"` handles (a `RopCreateMessage` draft, or an already-open `RopOpenMessage`
 * handle) and only tracks the small property set `TRACKED_PROPERTY_IDS` names - see that constant's own
 * comment for why. Every value is coerced to a plain string via `String()` before being stored in
 * `handle.draftProperties` (itself a `Record<string, string>` for `MapiSessionContext`'s own JSON-safety
 * reasons, see `MapiSessionManager.ts`) - safe here because every tracked property is always `PtypString` in
 * practice (a real client's own `PidTagSubject`/`PidTagDisplayTo`/etc. are always strings).
 *
 * Always reports success with zero `PropertyProblems`, even for a property this pragmatic subset doesn't
 * track - the same "never fail over an unsupported property" pragmatic stance `RopQueryRows`/
 * `RopGetPropertiesSpecific` already take (falling back to a default value there; simply not tracking the
 * property here, since there is no row to fill in for a *set* operation).
 *
 * @author Jean-Philippe Steinmetz
 */
export class RopSetPropertiesHandler implements RopHandler {
    public readonly ropId = ROP_ID_SET_PROPERTIES;

    public handle(reader: BufferReader, writer: BufferWriter, context: RopContext): void {
        reader.readUInt8(); // LogonId - this pragmatic subset doesn't track multiple concurrent logons per session
        const inputHandleIndex: number = reader.readUInt8();
        const propertyValueSize: number = reader.readUInt16LE();
        // PropertyValueSize covers the PropertyValueCount field itself plus PropertyValues, counted from right
        // here (immediately after the PropertyValueSize field, before PropertyValueCount is read).
        const propertyValuesEnd: number = reader.position + propertyValueSize;
        const propertyValueCount: number = reader.readUInt16LE();
        const values: TaggedPropertyValue[] = [];
        for (let i = 0; i < propertyValueCount; i++) {
            values.push(readTaggedPropertyValue(reader));
        }
        // PropertyValueSize is a byte-count check the request buffer itself provides for framing purposes (so a
        // generic ROP-skipping implementation could skip this ROP without decoding it) - this handler already
        // decoded PropertyValues field-by-field above, so the only remaining use is confirming the reader ended
        // up exactly where PropertyValueSize said it would, catching a malformed request loudly rather than
        // silently misaligning every ROP that follows in the same RopsList.
        if (reader.position !== propertyValuesEnd) {
            throw new Error("RopSetProperties: PropertyValueSize did not match the decoded PropertyValues length.");
        }

        const handle = context.session.handles[inputHandleIndex];
        if (!handle || handle.type !== "message") {
            writer.writeUInt8(ROP_ID_SET_PROPERTIES);
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt32LE(ERROR_INVALID_OBJECT);
            return;
        }

        handle.draftProperties ??= {};
        for (const tagged of values) {
            if (TRACKED_PROPERTY_IDS.has(tagged.propertyId)) {
                handle.draftProperties[String(tagged.propertyId)] = stringifyValue(tagged);
            }
        }

        writer.writeUInt8(ROP_ID_SET_PROPERTIES);
        writer.writeUInt8(inputHandleIndex);
        writer.writeUInt32LE(0); // ReturnValue - success
        writer.writeUInt16LE(0); // PropertyProblemCount - never reported, see class doc comment
    }
}

function stringifyValue(tagged: TaggedPropertyValue): string {
    if (tagged.propertyType === PropertyType.PtypString || tagged.propertyType === PropertyType.PtypString8) {
        return tagged.value as string;
    }
    return String(tagged.value);
}
