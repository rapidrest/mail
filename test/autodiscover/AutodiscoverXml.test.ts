///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// AutodiscoverXml is pure string logic with no DI/DB dependency, so it's tested directly here rather than only
// indirectly through a real-server HTTP round trip - the same precedent test/eas/codec/WbxmlCodec.test.ts sets
// for the WBXML codec.
import { buildPoxSuccessXml, escapeXml, extractEmailAddress } from "../../src/autodiscover/AutodiscoverXml.js";

describe("AutodiscoverXml Tests", () => {
    describe("extractEmailAddress", () => {
        it("Extracts the EMailAddress field from a real POX request body (no namespace prefix).", () => {
            const xml = `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="https://schemas.microsoft.com/exchange/autodiscover/mobilesync/requestschema/2006">
    <Request>
        <EMailAddress>chris@woodgrovebank.com</EMailAddress>
        <AcceptableResponseSchema>https://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006</AcceptableResponseSchema>
    </Request>
</Autodiscover>`;
            expect(extractEmailAddress(xml)).toBe("chris@woodgrovebank.com");
        });

        it("Extracts the field even when it is namespace-prefixed.", () => {
            const xml = `<autodiscover:Request><autodiscover:EMailAddress>a@example.com</autodiscover:EMailAddress></autodiscover:Request>`;
            expect(extractEmailAddress(xml)).toBe("a@example.com");
        });

        it("Trims surrounding whitespace/newlines around the value.", () => {
            const xml = `<EMailAddress>\n   spaced@example.com   \n</EMailAddress>`;
            expect(extractEmailAddress(xml)).toBe("spaced@example.com");
        });

        it("Decodes XML entities in the extracted value.", () => {
            const xml = `<EMailAddress>a&amp;b@example.com</EMailAddress>`;
            expect(extractEmailAddress(xml)).toBe("a&b@example.com");
        });

        it("Returns undefined when no EMailAddress element is present.", () => {
            expect(extractEmailAddress(`<Autodiscover><Request></Request></Autodiscover>`)).toBeUndefined();
        });

        it("Returns undefined when the element is present but empty.", () => {
            expect(extractEmailAddress(`<EMailAddress></EMailAddress>`)).toBeUndefined();
        });

        it("Returns undefined for a garbage/non-XML body.", () => {
            expect(extractEmailAddress("not xml at all")).toBeUndefined();
        });
    });

    describe("escapeXml", () => {
        it("Escapes all 5 XML-predefined-entity characters.", () => {
            expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
        });

        it("Leaves an already-safe string unchanged.", () => {
            expect(escapeXml("plain@example.com")).toBe("plain@example.com");
        });
    });

    describe("buildPoxSuccessXml", () => {
        it("Produces a well-formed mobilesync:Response with the expected structure and values.", () => {
            const xml = buildPoxSuccessXml({
                emailAddress: "chris@woodgrovebank.com",
                displayName: "Chris Gray",
                easUrl: "https://mail.example.com/Microsoft-Server-ActiveSync",
            });

            expect(xml).toContain(
                'xmlns:autodiscover="https://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006"',
            );
            expect(xml).toContain("<autodiscover:DisplayName>Chris Gray</autodiscover:DisplayName>");
            expect(xml).toContain("<autodiscover:EMailAddress>chris@woodgrovebank.com</autodiscover:EMailAddress>");
            expect(xml).toContain("<autodiscover:Type>MobileSync</autodiscover:Type>");
            expect(xml).toContain(
                "<autodiscover:Url>https://mail.example.com/Microsoft-Server-ActiveSync</autodiscover:Url>",
            );
            expect(xml).toContain(
                "<autodiscover:Name>https://mail.example.com/Microsoft-Server-ActiveSync</autodiscover:Name>",
            );
            expect(xml).not.toContain("CertEnroll");
        });

        it("Omits the DisplayName element entirely when no display name is given.", () => {
            const xml = buildPoxSuccessXml({
                emailAddress: "noname@example.com",
                easUrl: "https://mail.example.com/Microsoft-Server-ActiveSync",
            });
            expect(xml).not.toContain("DisplayName");
        });

        it("Escapes an XML-special character in the display name/email/url values.", () => {
            const xml = buildPoxSuccessXml({
                emailAddress: "a+tag@example.com",
                displayName: `Bob & "The Builder"`,
                easUrl: "https://mail.example.com/Microsoft-Server-ActiveSync?x=1&y=2",
            });
            expect(xml).toContain("<autodiscover:EMailAddress>a+tag@example.com</autodiscover:EMailAddress>");
            expect(xml).toContain("Bob &amp; &quot;The Builder&quot;");
            expect(xml).toContain("?x=1&amp;y=2");
        });

        it("Round-trips through extractEmailAddress for the email it embeds.", () => {
            const xml = buildPoxSuccessXml({
                emailAddress: "round@example.com",
                easUrl: "https://mail.example.com/Microsoft-Server-ActiveSync",
            });
            expect(extractEmailAddress(xml)).toBe("round@example.com");
        });
    });
});
