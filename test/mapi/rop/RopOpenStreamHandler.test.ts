///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BufferReader, BufferWriter } from "../../../src/mapi/codec/BufferCursor.js";
import { PropertyType, writePropertyTag } from "../../../src/mapi/codec/PropertyValue.js";
import { RopOpenStreamHandler } from "../../../src/mapi/rop/RopOpenStreamHandler.js";
import type { RopContext } from "../../../src/mapi/rop/RopHandler.js";
import { MapiSessionContext } from "../../../src/mapi/MapiSessionManager.js";
import { InMemoryBlobStore } from "../../testDoubles.js";

function buildRequest({
    logonId = 0,
    inputHandleIndex = 5,
    outputHandleIndex = 6,
    propertyTag = { propertyId: 0x1000, propertyType: PropertyType.PtypString },
    openModeFlags = 0,
}): Buffer {
    const writer = new BufferWriter();
    writer.writeUInt8(logonId);
    writer.writeUInt8(inputHandleIndex);
    writer.writeUInt8(outputHandleIndex);
    writePropertyTag(writer, propertyTag);
    writer.writeUInt8(openModeFlags);
    return writer.toBuffer();
}

async function makeContext(): Promise<RopContext> {
    const blobStore = new InMemoryBlobStore();
    await blobStore.put("bodies/m1", Buffer.from("Subject: Hi\r\n\r\nHello body."));
    const session = new MapiSessionContext({ mailboxUid: "mailbox-1", userUid: "user-1" });
    session.handles[5] = { type: "message", entityUid: "message:m1" };
    return {
        mailboxUid: "mailbox-1",
        userUid: "user-1",
        session,
        folderRepo: {} as any,
        messageRepo: { findOne: vi.fn().mockResolvedValue({ uid: "m1", bodyBlobKey: "bodies/m1" }) } as any,
        blobStore,
    };
}

describe("RopOpenStreamHandler Tests", () => {
    it("Has RopId 0x2B.", () => {
        expect(new RopOpenStreamHandler().ropId).toBe(0x2b);
    });

    it("Opens PidTagBody on a message handle, creating a stream handle with the correct StreamSize.", async () => {
        const context = await makeContext();
        const handler = new RopOpenStreamHandler();
        const writer = new BufferWriter();

        await handler.handle(new BufferReader(buildRequest({})), writer, context);

        const response = new BufferReader(writer.toBuffer());
        expect(response.readUInt8()).toBe(0x2b);
        expect(response.readUInt8()).toBe(6);
        expect(response.readUInt32LE()).toBe(0);
        const expectedSize = Buffer.concat([Buffer.from("Hello body.", "utf16le"), Buffer.from([0, 0])]).length;
        expect(response.readUInt32LE()).toBe(expectedSize);
        expect(response.hasMore()).toBe(false);

        expect(context.session.handles[6]).toEqual({
            type: "stream",
            entityUid: "message:m1",
            propertyId: 0x1000,
            propertyType: PropertyType.PtypString,
            streamPosition: 0,
        });
    });

    it("Returns MAPI_E_NOT_FOUND for an unsupported property tag.", async () => {
        const context = await makeContext();
        const handler = new RopOpenStreamHandler();
        const writer = new BufferWriter();

        await handler.handle(
            new BufferReader(buildRequest({ propertyTag: { propertyId: 0x1013, propertyType: PropertyType.PtypBinary } })),
            writer,
            context,
        );

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0x8004010f);
        expect(context.session.handles[6]).toBeUndefined();
    });

    it("Returns MAPI_E_NOT_FOUND when InputHandleIndex isn't a message handle.", async () => {
        const context = await makeContext();
        context.session.handles[5] = { type: "folder", entityUid: "folder:f1" };
        const handler = new RopOpenStreamHandler();
        const writer = new BufferWriter();

        await handler.handle(new BufferReader(buildRequest({})), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0x8004010f);
    });

    it("Returns MAPI_E_NOT_FOUND when InputHandleIndex references no handle at all.", async () => {
        const context = await makeContext();
        delete context.session.handles[5];
        const handler = new RopOpenStreamHandler();
        const writer = new BufferWriter();

        await handler.handle(new BufferReader(buildRequest({})), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0x8004010f);
    });
});
