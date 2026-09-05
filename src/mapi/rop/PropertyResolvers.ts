///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { PropertyType, PropertyValueData } from "../codec/PropertyValue.js";
import type { MapiSessionContext } from "../MapiSessionManager.js";
import { assignOrGetFid, FolderTargetInfo, resolveFolderInfo } from "./FolderTarget.js";
import { assignOrGetMid, MessageTargetInfo, resolveMessageInfo } from "./MessageTarget.js";
import type { RopContext } from "./RopHandler.js";

// Well-known folder property IDs this pragmatic subset supports - the small set a real client needs to render
// a folder-hierarchy view. Add more as a real need arises, not speculatively.
const PID_TAG_DISPLAY_NAME = 0x3001;
const PID_TAG_FOLDER_ID = 0x6748;
const PID_TAG_CONTENT_COUNT = 0x3602;
const PID_TAG_CONTENT_UNREAD_COUNT = 0x3603;
const PID_TAG_SUBFOLDERS = 0x360a;

// Well-known message property IDs this pragmatic subset supports - the small set a real client needs to render
// a message list or a single message's metadata.
const PID_TAG_SUBJECT = 0x0037;
const PID_TAG_MESSAGE_FLAGS = 0x0e07;
const PID_TAG_HAS_ATTACHMENTS = 0x0e1b;
const PID_TAG_MESSAGE_DELIVERY_TIME = 0x0e06;
const PID_TAG_MID = 0x674a;
/** `MSGFLAG_READ`, the one `PidTagMessageFlags` bit this pragmatic subset ever sets. */
const MSGFLAG_READ = 0x01;

/** A type-appropriate zero/empty value for a requested property this handler has no real data for - keeps
 * `StandardPropertyRow` encoding valid (a real value of the right type, per `writePropertyValue`'s
 * expectations) without needing to model every property a client could ever ask for. Shared by
 * `RopQueryRowsHandler` (table rows) and `RopGetPropertiesSpecificHandler` (single-object property fetch). */
export function defaultValueForType(propertyType: PropertyType): PropertyValueData {
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
        case PropertyType.PtypMultipleString:
        case PropertyType.PtypMultipleString8:
        case PropertyType.PtypMultipleBinary:
            return [];
        case PropertyType.PtypString:
        case PropertyType.PtypString8:
        default:
            return "";
    }
}

/** Resolves one requested property's value for a `"folder:<uid>"`/`"virtual:<name>"` target. */
export function folderValueFor(
    session: MapiSessionContext,
    propertyId: number,
    propertyType: PropertyType,
    target: string,
    info: FolderTargetInfo,
): PropertyValueData {
    switch (propertyId) {
        case PID_TAG_DISPLAY_NAME:
            return info.displayName;
        case PID_TAG_FOLDER_ID:
            return BigInt(assignOrGetFid(session, target));
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

/** Resolves one requested property's value for a `"message:<uid>"` target. */
export function messageValueFor(
    session: MapiSessionContext,
    propertyId: number,
    propertyType: PropertyType,
    target: string,
    info: MessageTargetInfo,
): PropertyValueData {
    switch (propertyId) {
        case PID_TAG_SUBJECT:
            return info.subject;
        case PID_TAG_MESSAGE_FLAGS:
            return info.read ? MSGFLAG_READ : 0;
        case PID_TAG_HAS_ATTACHMENTS:
            return info.hasAttachments;
        case PID_TAG_MESSAGE_DELIVERY_TIME:
            return info.receivedDate;
        case PID_TAG_MID:
            return BigInt(assignOrGetMid(session, target));
        default:
            return defaultValueForType(propertyType);
    }
}

/** Resolves every column in `columns` for a single `target` (a `"folder:"`/`"virtual:"`/`"message:"` target
 * string), in order - the shared implementation behind both `RopQueryRowsHandler` (one call per table row) and
 * `RopGetPropertiesSpecificHandler` (one call for the single object a handle refers to). */
export async function resolvePropertyValues(
    target: string,
    columns: { propertyId: number; propertyType: PropertyType }[],
    context: Pick<RopContext, "mailboxUid" | "session" | "folderRepo" | "messageRepo">,
): Promise<PropertyValueData[]> {
    const isMessage = target.startsWith("message:");
    const folderInfo = isMessage ? undefined : await resolveFolderInfo(context.mailboxUid, target, context.folderRepo);
    const messageInfo = isMessage ? await resolveMessageInfo(target, context.messageRepo) : undefined;
    return columns.map((column) =>
        messageInfo
            ? messageValueFor(context.session, column.propertyId, column.propertyType, target, messageInfo)
            : folderValueFor(context.session, column.propertyId, column.propertyType, target, folderInfo!),
    );
}
