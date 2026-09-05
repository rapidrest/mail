///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BufferReader, BufferWriter } from "../../../src/mapi/codec/BufferCursor.js";
import { PropertyType, writeTaggedPropertyValue, type TaggedPropertyValue } from "../../../src/mapi/codec/PropertyValue.js";
import { RopSetPropertiesHandler } from "../../../src/mapi/rop/RopSetPropertiesHandler.js";
import type { RopContext } from "../../../src/mapi/rop/RopHandler.js";
import { MapiSessionContext } from "../../../src/mapi/MapiSessionManager.js";

function buildRequest({ logonId = 0, inputHandleIndex = 5, values = [] as TaggedPropertyValue[] }): Buffer {
    const valuesWriter = new BufferWriter();
    for (const value of values) {
        writeTaggedPropertyValue(valuesWriter, value);
    }
    const valuesBytes = valuesWriter.toBuffer();

    const writer = new BufferWriter();
    writer.writeUInt8(logonId);
    writer.writeUInt8(inputHandleIndex);
    writer.writeUInt16LE(2 + valuesBytes.length); // PropertyValueSize (covers PropertyValueCount + PropertyValues)
    writer.writeUInt16LE(values.length);
    writer.writeBytes(valuesBytes);
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

describe("RopSetPropertiesHandler Tests", () => {
    it("Has RopId 0x0A.", () => {
        expect(new RopSetPropertiesHandler().ropId).toBe(0x0a);
    });

    it("Returns MAPI_E_INVALID_OBJECT when InputHandleIndex isn't a message handle.", () => {
        const context = makeContext();
        const handler = new RopSetPropertiesHandler();
        const writer = new BufferWriter();

        handler.handle(new BufferReader(buildRequest({})), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0x80070005);
        expect(response.hasMore()).toBe(false);
    });

    it("Tracks Subject/DisplayTo/DisplayCc/DisplayBcc/Body onto the message handle's draftProperties.", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "", draftFolderUid: "folder:f1", draftProperties: {} };
        const handler = new RopSetPropertiesHandler();
        const writer = new BufferWriter();

        const values: TaggedPropertyValue[] = [
            { propertyId: 0x0037, propertyType: PropertyType.PtypString, value: "Hello" },
            { propertyId: 0x0e04, propertyType: PropertyType.PtypString, value: "to@example.com" },
            { propertyId: 0x0e03, propertyType: PropertyType.PtypString, value: "cc@example.com" },
            { propertyId: 0x0e02, propertyType: PropertyType.PtypString, value: "bcc@example.com" },
            { propertyId: 0x1000, propertyType: PropertyType.PtypString, value: "Body text" },
        ];
        handler.handle(new BufferReader(buildRequest({ values })), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0); // ReturnValue
        expect(response.readUInt16LE()).toBe(0); // PropertyProblemCount
        expect(response.hasMore()).toBe(false);

        expect(context.session.handles[5]?.draftProperties).toEqual({
            "55": "Hello",
            "3588": "to@example.com",
            "3587": "cc@example.com",
            "3586": "bcc@example.com",
            "4096": "Body text",
        });
    });

    it("Accepts but does not track an unsupported property, still reporting success.", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "", draftFolderUid: "folder:f1", draftProperties: {} };
        const handler = new RopSetPropertiesHandler();
        const writer = new BufferWriter();

        const values: TaggedPropertyValue[] = [{ propertyId: 0x9999, propertyType: PropertyType.PtypInteger32, value: 42 }];
        handler.handle(new BufferReader(buildRequest({ values })), writer, context);

        const response = new BufferReader(writer.toBuffer());
        response.readUInt8();
        response.readUInt8();
        expect(response.readUInt32LE()).toBe(0);
        expect(context.session.handles[5]?.draftProperties).toEqual({});
    });

    it("Stringifies a tracked property's value via String() when it isn't already a PtypString/PtypString8.", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "", draftFolderUid: "folder:f1", draftProperties: {} };
        const handler = new RopSetPropertiesHandler();
        const writer = new BufferWriter();

        const values: TaggedPropertyValue[] = [{ propertyId: 0x0037, propertyType: PropertyType.PtypInteger32, value: 42 }];
        handler.handle(new BufferReader(buildRequest({ values })), writer, context);

        expect(context.session.handles[5]?.draftProperties).toEqual({ "55": "42" });
    });

    it("Initializes draftProperties when setting properties on a handle that has none yet.", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "message:m1" };
        const handler = new RopSetPropertiesHandler();
        const writer = new BufferWriter();

        const values: TaggedPropertyValue[] = [{ propertyId: 0x0037, propertyType: PropertyType.PtypString, value: "Hi" }];
        handler.handle(new BufferReader(buildRequest({ values })), writer, context);

        expect(context.session.handles[5]?.draftProperties).toEqual({ "55": "Hi" });
    });

    it("Throws if PropertyValueSize does not match the decoded PropertyValues length (malformed request).", () => {
        const context = makeContext();
        context.session.handles[5] = { type: "message", entityUid: "", draftProperties: {} };
        const handler = new RopSetPropertiesHandler();
        const writer = new BufferWriter();

        const malformed = buildRequest({ values: [{ propertyId: 0x0037, propertyType: PropertyType.PtypString, value: "Hi" }] });
        // Corrupt PropertyValueSize (bytes 2-3, little-endian) to no longer match the real encoded length.
        malformed.writeUInt16LE(9999, 2);

        expect(() => handler.handle(new BufferReader(malformed), writer, context)).toThrow(/PropertyValueSize/);
    });
});
