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

const ACCEPTABLE_RESPONSE_SCHEMA_PATTERN =
    /<[\w:]*AcceptableResponseSchema[^>]*>\s*([^<]*?)\s*<\/[\w:]*AcceptableResponseSchema>/i;

/** The `AcceptableResponseSchema` value a real Outlook desktop client sends to request the Outlook/EXCH
 * response shape (`buildOutlookSuccessXml`) instead of the EAS-only MobileSync one - confirmed against
 * `[MS-OXDSCLI]`'s own Autodiscover Response XSD, whose target namespace is exactly this value. */
export const OUTLOOK_RESPONSE_SCHEMA = "http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a";

/**
 * Extracts the request's `<AcceptableResponseSchema>` text content via the same small, tightly-scoped regex
 * approach as `extractEmailAddress` - never a DOM parse, same rationale (unauthenticated, internet-facing
 * endpoint).
 */
export function extractAcceptableResponseSchema(xml: string): string | undefined {
    const match = ACCEPTABLE_RESPONSE_SCHEMA_PATTERN.exec(xml);
    return match?.[1]?.trim() || undefined;
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

export interface AutodiscoverOutlookSuccess {
    emailAddress: string;
    displayName?: string;
    mapiUrl: string;
}

/**
 * Builds a real Outlook/EXCH `2006a` response per `[MS-OXDSCLI]`'s confirmed Autodiscover Response XSD -
 * an `Autodiscover`(namespace `.../responseschema/2006`) element wrapping a `Response`
 * (namespace `.../outlook/responseschema/2006a`) with `User`/`Account` children.
 *
 * Since this library only speaks MAPI/HTTP (no classic RPC/TCP MAPI transport), the response always
 * advertises exactly one `Protocol`, using `Type`/`Version` as XML ATTRIBUTES rather than the classic
 * `<Type>EXCH</Type>` child element - `[MS-OXDSCLI]`'s "Processing the X-MapiHttpCapability Header" section
 * confirms a mapiHttp-capable client's response "MUST include a Protocol element that contains a Type
 * attribute set to 'mapiHttp' and a Version attribute" and "MUST NOT include a Protocol element that contains
 * a Type element set to 'EXCH' or 'EXPR'" - the two forms are mutually exclusive by design, not merely
 * alternatives. This deployment has no classic RPC/TCP MAPI endpoint to fall back to, so every Outlook-schema
 * request always gets the mapiHttp form - the real `X-MapiHttpCapability` request-header negotiation a full
 * implementation would consult to choose between EXCH/mapiHttp is not implemented, a documented gap.
 * `MailStore.InternalUrl`/`ExternalUrl` are both set to the same `mapiUrl`, since this library serves one URL
 * per deployment with no separate internal/external network split.
 *
 * `LegacyDN`/`DeploymentId` are schema-required fields this library has no real backing value for (no X.500
 * DN resolution, no multi-tenant deployment identity) - both are synthesized placeholders. Real Outlook does
 * not validate their exact content for MAPI/HTTP connectivity; they matter for classic RPC/TCP MAPI
 * free-busy/permissions lookups this library doesn't implement anyway.
 */
export function buildOutlookSuccessXml({ emailAddress, displayName, mapiUrl }: AutodiscoverOutlookSuccess): string {
    const email = escapeXml(emailAddress);
    const url = escapeXml(mapiUrl);
    const name = escapeXml(displayName ?? emailAddress);
    const legacyDn = escapeXml(
        `/o=ExchangeLabs/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=${emailAddress}`,
    );
    return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
    <Response xmlns="${OUTLOOK_RESPONSE_SCHEMA}">
        <User>
            <DisplayName>${name}</DisplayName>
            <LegacyDN>${legacyDn}</LegacyDN>
            <AutoDiscoverSMTPAddress>${email}</AutoDiscoverSMTPAddress>
            <DeploymentId>00000000-0000-0000-0000-000000000000</DeploymentId>
        </User>
        <Account>
            <AccountType>email</AccountType>
            <Action>settings</Action>
            <MicrosoftOnline>False</MicrosoftOnline>
            <Protocol Type="mapiHttp" Version="1">
                <MailStore>
                    <InternalUrl>${url}</InternalUrl>
                    <ExternalUrl>${url}</ExternalUrl>
                </MailStore>
            </Protocol>
        </Account>
    </Response>
</Autodiscover>`;
}
