///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/**
 * Minimal, purpose-built XML handling for the classic POX Autodiscover request/response (`[MS-ASCMD]`'s
 * "MobileSync" schema) - deliberately NOT a general-purpose XML/DOM parser. `BaseAutodiscoverRoute`'s POX
 * endpoint is unauthenticated and internet-facing (see its own doc comment for why), and the real request
 * schema has exactly one field this library ever reads (`EMailAddress`), so pulling in a general XML parser -
 * especially one not hardened against XXE/entity-expansion - would be real attack surface for zero benefit.
 * This follows the same "hand-build the wire format precisely, no library" approach Phase 2's WBXML codec
 * already took, just for text XML instead of binary.
 */

const EMAIL_ELEMENT_PATTERN = /<[\w:]*EMailAddress[^>]*>\s*([^<]*?)\s*<\/[\w:]*EMailAddress>/i;

/**
 * Extracts the request's `<EMailAddress>` text content via a small, tightly-scoped regex rather than a DOM
 * parse. Never resolves entities/DTDs - only the literal text between the open/close tags is ever inspected.
 */
export function extractEmailAddress(xml: string): string | undefined {
    const match = EMAIL_ELEMENT_PATTERN.exec(xml);
    const value = match?.[1]?.trim();
    return value ? decodeXmlEntities(value) : undefined;
}

/** Escapes the 5 XML-predefined-entity characters for safe inclusion as element text content. */
export function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

export interface AutodiscoverPoxSuccess {
    emailAddress: string;
    displayName?: string;
    easUrl: string;
}

/**
 * Builds a real `mobilesync:Response` success document per `[MS-ASCMD]`'s `AutodiscoverMobileSync.xsd` -
 * `Culture`/`User`/`Action.Settings.Server{Type=MobileSync,Url,Name}`, matching the shape confirmed against
 * Microsoft's own "Autodiscover for Exchange ActiveSync developers" example response. A real response can also
 * carry a `CertEnroll` server block for client-certificate enrollment - deliberately omitted, same "pragmatic
 * subset" scoping as Phase 2's own documented gaps, since this library has no certificate-enrollment support.
 */
export function buildPoxSuccessXml({ emailAddress, displayName, easUrl }: AutodiscoverPoxSuccess): string {
    const email = escapeXml(emailAddress);
    const url = escapeXml(easUrl);
    const displayNameElement = displayName
        ? `\n            <autodiscover:DisplayName>${escapeXml(displayName)}</autodiscover:DisplayName>`
        : "";
    return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns:autodiscover="https://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006">
    <autodiscover:Response>
        <autodiscover:Culture>en:us</autodiscover:Culture>
        <autodiscover:User>${displayNameElement}
            <autodiscover:EMailAddress>${email}</autodiscover:EMailAddress>
        </autodiscover:User>
        <autodiscover:Action>
            <autodiscover:Settings>
                <autodiscover:Server>
                    <autodiscover:Type>MobileSync</autodiscover:Type>
                    <autodiscover:Url>${url}</autodiscover:Url>
                    <autodiscover:Name>${url}</autodiscover:Name>
                </autodiscover:Server>
            </autodiscover:Settings>
        </autodiscover:Action>
    </autodiscover:Response>
</Autodiscover>`;
}
