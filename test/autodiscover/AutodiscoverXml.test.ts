///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// AutodiscoverXml is pure string logic with no DI/DB dependency, so it's tested directly here rather than only
// indirectly through a real-server HTTP round trip - the same precedent test/eas/codec/WbxmlCodec.test.ts sets
// for the WBXML codec.
import {
    buildOutlookSuccessXml,
    buildPoxSuccessXml,
    escapeXml,
    extractAcceptableResponseSchema,
    extractEmailAddress,
    OUTLOOK_RESPONSE_SCHEMA,
} from "../../src/autodiscover/AutodiscoverXml.js";

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

    describe("extractAcceptableResponseSchema", () => {
        it("Extracts the AcceptableResponseSchema field from a real Outlook request body.", () => {
            const xml = `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006">
    <Request>
        <EMailAddress>chris@woodgrovebank.com</EMailAddress>
        <AcceptableResponseSchema>${OUTLOOK_RESPONSE_SCHEMA}</AcceptableResponseSchema>
    </Request>
</Autodiscover>`;
            expect(extractAcceptableResponseSchema(xml)).toBe(OUTLOOK_RESPONSE_SCHEMA);
        });

        it("Extracts the field even when it is namespace-prefixed.", () => {
            const xml = `<autodiscover:AcceptableResponseSchema>https://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006</autodiscover:AcceptableResponseSchema>`;
            expect(extractAcceptableResponseSchema(xml)).toBe(
                "https://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006",
            );
        });

        it("Returns undefined when no AcceptableResponseSchema element is present.", () => {
            expect(extractAcceptableResponseSchema(`<Autodiscover><Request></Request></Autodiscover>`)).toBeUndefined();
        });

        it("Returns undefined when the element is present but empty.", () => {
            expect(extractAcceptableResponseSchema(`<AcceptableResponseSchema></AcceptableResponseSchema>`)).toBeUndefined();
        });
    });

    describe("buildOutlookSuccessXml", () => {
        it("Produces a well-formed Outlook/EXCH 2006a Response with the expected structure and values.", () => {
            const xml = buildOutlookSuccessXml({
                emailAddress: "chris@woodgrovebank.com",
                displayName: "Chris Gray",
                mapiUrl: "https://mail.example.com/mapi/emsmdb",
            });

            expect(xml).toContain('xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006"');
            expect(xml).toContain(`<Response xmlns="${OUTLOOK_RESPONSE_SCHEMA}">`);
            expect(xml).toContain("<DisplayName>Chris Gray</DisplayName>");
            expect(xml).toContain("<AutoDiscoverSMTPAddress>chris@woodgrovebank.com</AutoDiscoverSMTPAddress>");
            expect(xml).toContain('<Protocol Type="mapiHttp" Version="1">');
            expect(xml).toContain("<InternalUrl>https://mail.example.com/mapi/emsmdb</InternalUrl>");
            expect(xml).toContain("<ExternalUrl>https://mail.example.com/mapi/emsmdb</ExternalUrl>");
            expect(xml).not.toContain("<Type>EXCH</Type>");
            expect(xml).not.toContain("<Type>EXPR</Type>");
        });

        it("Falls back to the email address as DisplayName when no display name is given.", () => {
            const xml = buildOutlookSuccessXml({
                emailAddress: "noname@example.com",
                mapiUrl: "https://mail.example.com/mapi/emsmdb",
            });
            expect(xml).toContain("<DisplayName>noname@example.com</DisplayName>");
        });

        it("Escapes an XML-special character in the display name/email/url values.", () => {
            const xml = buildOutlookSuccessXml({
                emailAddress: "a+tag@example.com",
                displayName: `Bob & "The Builder"`,
                mapiUrl: "https://mail.example.com/mapi/emsmdb?x=1&y=2",
            });
            expect(xml).toContain("<AutoDiscoverSMTPAddress>a+tag@example.com</AutoDiscoverSMTPAddress>");
            expect(xml).toContain("Bob &amp; &quot;The Builder&quot;");
            expect(xml).toContain("?x=1&amp;y=2");
        });
    });
});
