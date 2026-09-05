///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BufferReader, BufferWriter } from "../codec/BufferCursor.js";
import { PropertyType, PropertyValueData, writePropertyValue } from "../codec/PropertyValue.js";
import { assignOrGetFid, FolderTargetInfo, resolveFolderInfo } from "./FolderTarget.js";
import { MessageTargetInfo, resolveMessageInfo } from "./MessageTarget.js";
import type { RopContext, RopHandler } from "./RopHandler.js";

const ROP_ID_QUERY_ROWS = 0x15;

/** The well-known MAPI HRESULT `MAPI_E_INVALID_OBJECT`, reused for "the referenced handle isn't a table (or
 * doesn't exist)" - the same constant `RopGetHierarchyTableHandler` uses for its own analogous check. */
const ERROR_INVALID_OBJECT = 0x80070005;

/** `BOOKMARK_END` (`[MS-OXCTABL]`'s `Origin` field) - this pragmatic subset has no separate seek/bookmark ROP
 * support, so every response reports the cursor as having landed at the table's current end. */
const ORIGIN_BOOKMARK_END = 0x02;

// Well-known folder property IDs this pragmatic subset supports as RopQueryRows columns - the small set a
// real client needs to render a folder-hierarchy view. Add more as a real need arises, not speculatively.
const PID_TAG_DISPLAY_NAME = 0x3001;
const PID_TAG_FOLDER_ID = 0x6748;
const PID_TAG_CONTENT_COUNT = 0x3602;
const PID_TAG_CONTENT_UNREAD_COUNT = 0x3603;
const PID_TAG_SUBFOLDERS = 0x360a;

// Well-known message property IDs this pragmatic subset supports as RopQueryRows columns (a folder's contents
// table, RopGetContentsTable) - the small set a real client needs to render a message list.
const PID_TAG_SUBJECT = 0x0037;
const PID_TAG_MESSAGE_FLAGS = 0x0e07;
const PID_TAG_HAS_ATTACHMENTS = 0x0e1b;
const PID_TAG_MESSAGE_DELIVERY_TIME = 0x0e06;
/** `MSGFLAG_READ`, the one `PidTagMessageFlags` bit this pragmatic subset ever sets. */
const MSGFLAG_READ = 0x01;

/**
 * `RopQueryRows` (`[MS-OXCTABL]`/`[MS-OXCROPS]`): fetches up to `RowCount` rows from an already-configured
 * table (`RopGetHierarchyTable` + `RopSetColumns`), advancing the table's cursor. Confirmed field-by-field
 * against `[MS-OXCTABL]`'s own real captured request/response byte example - including the response's
 * `RowData` encoding (`PropertyRow`: a leading `Flags` byte, `0x00` for a `StandardPropertyRow` where every
 * column is a plain `PropertyValue`, `0x01` for a `FlaggedPropertyRow` where each column gets its own
 * `FlaggedPropertyValue` flag+optional-value). This pragmatic subset always emits `StandardPropertyRow`
 * (`Flags = 0x00`) - every configured column always resolves to *some* value here (falling back to a
 * type-appropriate zero/empty default for an unsupported property, never an error), so `FlaggedPropertyRow`'s
 * per-column error signaling is never needed.
 *
 * Backward reads (`ForwardRead = FALSE`) and the `NoAdvance` flag are decoded (to advance the reader
 * correctly) but not honored - this pragmatic subset's tables are simple forward-only cursors. Works generically
 * against either a `RopGetHierarchyTable` (folder rows, `"folder:"`/`"virtual:"` targets) or a
 * `RopGetContentsTable` (message rows, `"message:"` targets) handle - dispatching to `FolderTarget`'s or
 * `MessageTarget`'s resolver and property-value mapping by row-target prefix, since a single table handle only
 * ever holds one kind of row.
 *
 * @author Jean-Philippe Steinmetz
 */
export class RopQueryRowsHandler implements RopHandler {
    public readonly ropId = ROP_ID_QUERY_ROWS;

    public async handle(reader: BufferReader, writer: BufferWriter, context: RopContext): Promise<void> {
        reader.readUInt8(); // LogonId - this pragmatic subset doesn't track multiple concurrent logons per session
        const inputHandleIndex: number = reader.readUInt8();
        reader.readUInt8(); // QueryRowsFlags - NoAdvance/EnablePackedBuffers not supported; always advances
        reader.readUInt8(); // ForwardRead - backward reads not supported; always reads forward
        const requestedCount: number = reader.readUInt16LE();

        const table = context.session.handles[inputHandleIndex];
        if (!table || table.type !== "table") {
            writer.writeUInt8(ROP_ID_QUERY_ROWS);
            writer.writeUInt8(inputHandleIndex);
            writer.writeUInt32LE(ERROR_INVALID_OBJECT);
            return;
        }

        const rows: string[] = table.rows ?? [];
        const cursor: number = table.cursor ?? 0;
        const slice: string[] = rows.slice(cursor, cursor + requestedCount);
        table.cursor = cursor + slice.length;

        const rowBuffers: Buffer[] = [];
        for (const target of slice) {
            rowBuffers.push(await this.buildRow(context, target, table.columns ?? []));
        }

        writer.writeUInt8(ROP_ID_QUERY_ROWS);
        writer.writeUInt8(inputHandleIndex);
        writer.writeUInt32LE(0); // ReturnValue - success
        writer.writeUInt8(ORIGIN_BOOKMARK_END);
        writer.writeUInt16LE(slice.length);
        for (const rowBuffer of rowBuffers) {
            writer.writeBytes(rowBuffer);
        }
    }

    private async buildRow(
        context: RopContext,
        target: string,
        columns: { propertyId: number; propertyType: number }[],
    ): Promise<Buffer> {
        const writer = new BufferWriter();
        writer.writeUInt8(0x00); // Flags - StandardPropertyRow, see class doc comment
        const isMessage = target.startsWith("message:");
        const folderInfo = isMessage ? undefined : await resolveFolderInfo(context.mailboxUid, target, context.folderRepo);
        const messageInfo = isMessage ? await resolveMessageInfo(target, context.messageRepo) : undefined;
        for (const column of columns) {
            const value = messageInfo
                ? this.messageValueFor(column.propertyId, column.propertyType, messageInfo)
                : this.folderValueFor(column.propertyId, column.propertyType, target, folderInfo!, context);
            writePropertyValue(writer, column.propertyType, value);
        }
        return writer.toBuffer();
    }

    private folderValueFor(
        propertyId: number,
        propertyType: PropertyType,
        target: string,
        info: FolderTargetInfo,
        context: RopContext,
    ): PropertyValueData {
        switch (propertyId) {
            case PID_TAG_DISPLAY_NAME:
                return info.displayName;
            case PID_TAG_FOLDER_ID:
                return BigInt(assignOrGetFid(context.session, target));
            case PID_TAG_CONTENT_COUNT:
                return info.totalCount;
            case PID_TAG_CONTENT_UNREAD_COUNT:
                return info.unreadCount;
            case PID_TAG_SUBFOLDERS:
                return info.hasChildren;
            default:
                return defaultValueForType(propertyType);
        }
    }

    private messageValueFor(propertyId: number, propertyType: PropertyType, info: MessageTargetInfo): PropertyValueData {
        switch (propertyId) {
            case PID_TAG_SUBJECT:
                return info.subject;
            case PID_TAG_MESSAGE_FLAGS:
                return info.read ? MSGFLAG_READ : 0;
            case PID_TAG_HAS_ATTACHMENTS:
                return info.hasAttachments;
            case PID_TAG_MESSAGE_DELIVERY_TIME:
                return info.receivedDate;
            default:
                return defaultValueForType(propertyType);
        }
    }
}

/** A type-appropriate zero/empty value for a configured column this handler has no real data for - keeps
 * `StandardPropertyRow` encoding valid (a real value of the right type, per `writePropertyValue`'s
 * expectations) without needing to model every property a client could ever ask for. */
function defaultValueForType(propertyType: PropertyType): PropertyValueData {
    switch (propertyType) {
        case PropertyType.PtypBoolean:
            return false;
        case PropertyType.PtypInteger16:
        case PropertyType.PtypInteger32:
        case PropertyType.PtypFloating32:
        case PropertyType.PtypFloating64:
            return 0;
        case PropertyType.PtypInteger64:
            return 0n;
        case PropertyType.PtypTime:
            return new Date(0);
        case PropertyType.PtypGuid:
            return "00000000-0000-0000-0000-000000000000";
        case PropertyType.PtypBinary:
            return Buffer.alloc(0);
        case PropertyType.PtypMultipleInteger32:
            return [];
        case PropertyType.PtypMultipleString:
        case PropertyType.PtypMultipleString8:
            return [];
        case PropertyType.PtypMultipleBinary:
            return [];
        case PropertyType.PtypString:
        case PropertyType.PtypString8:
        default:
            return "";
    }
}
