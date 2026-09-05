///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { ObjectFactory, RedisCache, SimpleEntity } from "@rapidrest/service-core";
const { Init } = ObjectDecorators;

/** A pragmatic idle-session lifetime. The spec leaves session lifetime to server policy, not a fixed wire
 * value - a real client re-establishes (`Connect`) transparently whenever its session context has expired. */
const SESSION_TTL_SECONDS = 15 * 60;

/** Tags what a ROP-assigned integer handle (the `ServerObjectHandleTable` index space) refers to. A table
 * handle's `cursor`/`columns` hold `RopSetColumns`/`RopQueryRows` state for that specific table instance. */
export interface MapiObjectHandle {
    type: "logon" | "folder" | "message" | "table";
    entityUid: string;
    cursor?: number;
    columns?: number[];
}

/**
 * The MAPI/HTTP `Session Context` (`[MS-OXCMAPIHTTP]` §3.1.1.1): everything a `Connect`-established session
 * needs across subsequent `Execute` requests. Never persisted to a real database - purely an ephemeral,
 * TTL-bound cache entry (see `MapiSessionManager` below), so this deliberately extends `SimpleEntity` (just a
 * `uid`) rather than this library's own `BaseEntity`, which would add ACL/soft-delete/optimistic-locking
 * machinery this object has no use for.
 *
 * `createdAt` is a plain ISO-8601 string, not a `Date` - `RedisCache`'s Redis-backed path round-trips values
 * through `JSON.stringify`/`JSON.parse`, which silently turns a `Date` into a string on the way out without
 * reviving it back to a `Date` on the way in; storing it as a string from the start keeps the shape identical
 * whether a session happens to be served from the in-memory or the Redis-backed path.
 */
export class MapiSessionContext extends SimpleEntity {
    public mailboxUid: string;
    public userUid: string;
    public handles: Record<number, MapiObjectHandle> = {};
    public nextHandleIndex = 1;
    public createdAt: string = new Date().toISOString();

    /** `mailboxUid`/`userUid` are always known at construction time (the only call site is
     * `MapiSessionManager.create()`, which resolves both up front) - required here rather than optional with
     * a same-value fallback, which would just be dead code no real caller ever takes the other branch of. */
    public constructor(other: Partial<SimpleEntity> & { mailboxUid: string; userUid: string }) {
        super(other);
        this.mailboxUid = other.mailboxUid;
        this.userUid = other.userUid;
    }
}

/**
 * Stores/loads `MapiSessionContext`s, keyed by the opaque session id that also becomes the `MapiContext`
 * cookie value. Reuses `@rapidrest/service-core`'s existing generic `RedisCache<T>` (Redis-backed when a
 * `cache` datastore is configured, transparent in-memory fallback otherwise) rather than either a bespoke
 * Redis client (unlike `PingCommand`'s own throwaway pub/sub client - fine for ephemeral fan-out, not a good
 * fit for stateful session data) or the framework's generic cookie/session middleware (built for a whole-app
 * `req.session` object, not this protocol's specific handle-table shape). `RedisCache` needs no real
 * persisted entity - only a class with a `.name` for its Redis key prefix - so a purely ephemeral,
 * never-persisted class like `MapiSessionContext` is a perfectly valid `type` for it.
 *
 * @author Jean-Philippe Steinmetz
 */
export class MapiSessionManager {
    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private cache?: RedisCache<MapiSessionContext>;

    @Init
    public async init(): Promise<void> {
        this.cache = await this._objectFactory!.newInstance(RedisCache, {
            name: MapiSessionContext.name,
            args: [MapiSessionContext],
        });
    }

    public async create(mailboxUid: string, userUid: string): Promise<MapiSessionContext> {
        const context = new MapiSessionContext({ mailboxUid, userUid });
        await this.cache!.save(context.uid, context, SESSION_TTL_SECONDS);
        return context;
    }

    public async load(sessionId: string): Promise<MapiSessionContext | undefined> {
        return this.cache!.load(sessionId);
    }

    public async save(context: MapiSessionContext): Promise<void> {
        await this.cache!.save(context.uid, context, SESSION_TTL_SECONDS);
    }

    public async destroy(sessionId: string): Promise<void> {
        await this.cache!.delete(sessionId);
    }
}
