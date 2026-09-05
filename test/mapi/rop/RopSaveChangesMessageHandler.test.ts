///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BufferReader, BufferWriter } from "../../../src/mapi/codec/BufferCursor.js";
import { RopSaveChangesMessageHandler } from "../../../src/mapi/rop/RopSaveChangesMessageHandler.js";
import type { RopContext } from "../../../src/mapi/rop/RopHandler.js";
import { MapiSessionContext } from "../../../src/mapi/MapiSessionManager.js";

function buildRequest({ logonId = 0, responseHandleIndex = 7, inputHandleIndex = 5, saveFlags = 0 }): Buffer {
    const writer = new BufferWriter();
    writer.writeUInt8(logonId);
    writer.writeUInt8(responseHandleIndex);
    writer.writeUInt8(inputHandleIndex);
    writer.writeUInt8(saveFlags);
    return writer.toBuffer();
}

function makeContext(): RopContext {
    return {
        mailboxUid: "mailbox-1",
        userUid: "user-1",
        session: new MapiSessionContext({ mailboxUid: "mailbox-1", userUid: "user-1" }),
        folderRepo: {} as any,
        messageRepo: {} as any,
        mailboxRepo: {} as any,
        folderClass: {} as any,
        messageClass: {} as any,
        scanPipeline: {} as any,
        mailTransport: {} as any,
        blobStore: {} as any,
    };
}

describe("RopSaveChangesMessageHandler Tests", () => {
    it("Has RopId 0x0C.", () => {
        expect(new RopSaveChangesMessageHandler().ropId).toBe(0x0c);
    });

    it("Returns MAPI_E_INVALID_OBJECT when InputHandleIndex isn't a message handle.", () => {
        const context = makeContext();
        const handler = new RopSaveChangesMessageHandler();
        const writer = new BufferWriter();

        handler.handle(new BufferReader(buildRequest({})), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0x80070005);
        expect(response.hasMore()).toBe(false);
    });

    it("Assigns a session-scoped MID to a fresh draft, stable across repeated saves of the same handle.", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "", draftFolderUid: "folder:f1", draftProperties: {} };
        const handler = new RopSaveChangesMessageHandler();

        const writer1 = new BufferWriter();
        handler.handle(new BufferReader(buildRequest({})), writer1, context);
        const response1 = new BufferReader(writer1.toBuffer());
        expect(response1.readUInt8()).toBe(0x0c);
        expect(response1.readUInt8()).toBe(7); // ResponseHandleIndex
        expect(response1.readUInt32LE()).toBe(0); // ReturnValue
        expect(response1.readUInt8()).toBe(5); // InputHandleIndex, echoed
        const mid1 = response1.readBigUInt64LE();
        expect(mid1).toBeGreaterThan(0n);
        expect(response1.hasMore()).toBe(false);

        const writer2 = new BufferWriter();
        handler.handle(new BufferReader(buildRequest({})), writer2, context);
        const response2 = new BufferReader(writer2.toBuffer());
        response2.readUInt8();
        response2.readUInt8();
        response2.readUInt32LE();
        response2.readUInt8();
        const mid2 = response2.readBigUInt64LE();
        expect(mid2).toBe(mid1);
    });

    it("Echoes an already-real message's own MID when re-saving an opened (not freshly created) message.", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "message:m1" };
        const handler = new RopSaveChangesMessageHandler();
        const writer = new BufferWriter();

        handler.handle(new BufferReader(buildRequest({})), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0);
        response.readUInt8();
        expect(response.readBigUInt64LE()).toBeGreaterThan(0n);
        expect(Object.values(context.session.messageIds)).toContain("message:m1");
    });
});
