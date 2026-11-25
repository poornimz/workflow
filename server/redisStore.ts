import type { RedisKeyEntry, RedisTelemetry } from '../shared/types.ts';

interface StoredEntry<T = unknown> {
  value: T;
  namespace: 'session' | 'board' | 'projects';
  tenantId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  preview: string;
}

class RedisBackedStore {
  private store = new Map<string, StoredEntry>();
  private hits = 0;
  private misses = 0;
  private invalidations = 0;

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAtMs <= now) {
        this.store.delete(key);
      }
    }
  }

  public set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    meta: {
      namespace: 'session' | 'board' | 'projects';
      tenantId: string | null;
      preview: string;
    }
  ): void {
    this.pruneExpired();
    const now = Date.now();
    this.store.set(key, {
      value,
      namespace: meta.namespace,
      tenantId: meta.tenantId,
      createdAtMs: now,
      expiresAtMs: now + ttlSeconds * 1000,
      preview: meta.preview,
    });
  }

  public get<T>(key: string, countMetrics = true): { value: T; ttlRemainingSeconds: number; createdAt: string } | null {
    const entry = this.store.get(key);
    if (!entry) {
      if (countMetrics) this.misses += 1;
      return null;
    }
    const now = Date.now();
    if (entry.expiresAtMs <= now) {
      this.store.delete(key);
      if (countMetrics) this.misses += 1;
      return null;
    }
    if (countMetrics) this.hits += 1;
    return {
      value: entry.value as T,
      ttlRemainingSeconds: Math.max(1, Math.ceil((entry.expiresAtMs - now) / 1000)),
      createdAt: new Date(entry.createdAtMs).toISOString(),
    };
  }

  public del(key: string): boolean {
    const existed = this.store.delete(key);
    if (existed) {
      this.invalidations += 1;
    }
    return existed;
  }

  public delByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.invalidations += removed;
    }
    return removed;
  }

  public invalidateTenantBoards(tenantId: string): number {
    const boardRemoved = this.delByPrefix(`board:tenant:${tenantId}:`);
    const listRemoved = this.delByPrefix(`projects:tenant:${tenantId}:`);
    return boardRemoved + listRemoved;
  }

  public getTelemetry(filterTenantId?: string | null): RedisTelemetry {
    this.pruneExpired();
    const now = Date.now();
    const entries: RedisKeyEntry[] = [];
    let activeSessions = 0;
    let cachedBoards = 0;

    for (const [key, entry] of this.store.entries()) {
      if (filterTenantId && entry.tenantId && entry.tenantId !== filterTenantId) {
        continue;
      }
      if (entry.namespace === 'session') activeSessions += 1;
      if (entry.namespace === 'board') cachedBoards += 1;

      entries.push({
        key,
        namespace: entry.namespace,
        tenantId: entry.tenantId,
        ttlRemainingSeconds: Math.max(1, Math.ceil((entry.expiresAtMs - now) / 1000)),
        createdAt: new Date(entry.createdAtMs).toISOString(),
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
        preview: entry.preview,
      });
    }

    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const totalReads = this.hits + this.misses;
    const hitRatePercent = totalReads === 0 ? 0 : Math.round((this.hits / totalReads) * 100);

    return {
      engine: 'Redis-Compatible Session & Cache Store',
      activeKeys: entries.length,
      activeSessions,
      cachedBoards,
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations,
      hitRatePercent,
      entries,
    };
  }
}

export const redisStore = new RedisBackedStore();
