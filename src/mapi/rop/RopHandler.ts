///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { RepoUtils } from "@rapidrest/service-core";
import type { BlobStore } from "../../blob/BlobStore.js";
import type { BufferReader, BufferWriter } from "../codec/BufferCursor.js";
import type { MapiSessionContext } from "../MapiSessionManager.js";

/**
 * Everything a `RopHandler` needs beyond the raw ROP bytes it decodes itself. `folderRepo` is built once by
 * `BaseMapiEmsmdbRoute` (not by each handler, unlike EAS's per-command repo pattern - MAPI's ROPs are far
 * more tightly interdependent around the same few entity types than EAS's per-command-collection-type
 * structure was, so centralizing the common repos here avoids every handler rebuilding its own). Untyped as
 * `RepoUtils<any>` rather than a generic `F extends Folder` parameter threaded through every handler file -
 * the same pragmatic `any` this codebase already uses throughout for `xxxClass`/`xxxRepo` DI fields, since
 * `RepoUtils<F>`'s method contravariance makes a generic version genuinely awkward for no real benefit here
 * (every handler only ever reads `Folder`-shaped rows, never constructs backend-specific entities itself).
 */
export interface RopContext {
    mailboxUid: string;
    userUid: string;
    session: MapiSessionContext;
    folderRepo: RepoUtils<any>;
    messageRepo: RepoUtils<any>;
    blobStore: BlobStore;
}

/**
 * One class per ROP, mirroring `EasCommandHandler`'s exact one-class-per-command convention. A handler owns
 * its own request/response wire format entirely - decoding whatever fields follow its own `RopId` byte from
 * `reader` (already consumed by the dispatcher) and appending its response bytes (if any - `RopRelease`
 * intentionally appends none) to the shared `writer`. See `RopBuffer.ts`'s doc comment for why a generic
 * dispatcher can't do this decoding itself.
 */
export interface RopHandler {
    /** The `RopId` byte this handler processes (e.g. `0xFE` for `RopLogon`). */
    readonly ropId: number;
    handle(reader: BufferReader, writer: BufferWriter, context: RopContext): Promise<void> | void;
}
