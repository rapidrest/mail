///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { RepoUtils } from "@rapidrest/service-core";
import { Message } from "../../models/types.js";

/**
 * The `RopGetContentsTable` analog of `FolderTarget.ts`: resolves a `"message:<uid>"` row target (see
 * `RopGetContentsTableHandler`'s own doc comment for why contents-table rows use this prefix instead of
 * `FolderTarget.ts`'s `"folder:"`/`"virtual:"`) into the display data a message-table row needs.
 */
export interface MessageTargetInfo {
    subject: string;
    read: boolean;
    hasAttachments: boolean;
    receivedDate: Date;
}

/** Degrades to empty-looking values for a `"message:<uid>"` target whose real `Message` has since vanished
 * (soft-deleted or otherwise), the same "don't fail the whole ROP over one stale row" principle
 * `FolderTarget.resolveFolderInfo` already applies. */
export async function resolveMessageInfo(target: string, messageRepo: RepoUtils<any>): Promise<MessageTargetInfo> {
    const uid = target.slice("message:".length);
    const message: Message | undefined = await messageRepo.findOne(uid, { ignoreACL: true });
    return {
        subject: message?.subject ?? "",
        read: message?.flags?.read ?? false,
        hasAttachments: message?.hasAttachments ?? false,
        receivedDate: message?.receivedDate ?? new Date(0),
    };
}

/** Resolves the messages directly in `folderUid`, as `"message:<uid>"` target strings, for
 * `RopGetContentsTable`. */
export async function resolveFolderMessages(folderUid: string, messageRepo: RepoUtils<any>): Promise<string[]> {
    const messages: Message[] = await messageRepo.find({ folderUid }, { ignoreACL: true });
    return messages.map((m) => `message:${m.uid}`);
}
