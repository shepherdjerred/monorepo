import { MILLIS_PER_DAY } from "#shared/seaweedfs-lifecycle/types.ts";
import type {
  DeleteFailure,
  LifecycleRuleDocument,
  LifecycleS3,
  ListedObject,
  ListedPage,
} from "./core.ts";

export const NOW_MS = Date.UTC(2026, 10, 26, 12, 0, 0);

/** A LastModified `days` days (and `extraMs` more) before {@link NOW_MS}. */
export function daysAgo(days: number, extraMs = 0): Date {
  return new Date(NOW_MS - days * MILLIS_PER_DAY - extraMs);
}

type StoredObject = {
  size: number;
  lastModified: Date | undefined;
  /** When set, LastModified is derived from {@link FakeLifecycleS3.nowMs}. */
  ageDays?: number;
};

/** An in-memory S3 that records every list and delete request it serves. */
export class FakeLifecycleS3 implements LifecycleS3 {
  readonly objects = new Map<string, Map<string, StoredObject>>();
  readonly lifecycles = new Map<
    string,
    readonly LifecycleRuleDocument[] | undefined
  >();
  readonly listCalls: {
    bucket: string;
    prefix: string;
    token: string | undefined;
  }[] = [];
  readonly deleteCalls: { bucket: string; keys: readonly string[] }[] = [];
  /** Keys per page; may exceed 1000 to exercise delete batch splitting. */
  pageSize = 1000;
  /** Serve keys outside the requested prefix, as a misbehaving server might. */
  ignorePrefix = false;
  failDeleteKeys = new Set<string>();
  /** The clock `putAged` objects are aged against. */
  nowMs = NOW_MS;
  /** Throw from `listObjects` on this (1-based) call number, once. */
  failListOnCall: number | undefined;
  private listCount = 0;

  put(
    bucket: string,
    key: string,
    lastModified: Date | undefined,
    size = 100,
  ): void {
    const bucketObjects =
      this.objects.get(bucket) ?? new Map<string, StoredObject>();
    bucketObjects.set(key, { size, lastModified });
    this.objects.set(bucket, bucketObjects);
  }

  /** An object written `ageDays` before whatever clock the caller measures by. */
  putAged(bucket: string, key: string, ageDays: number, size = 100): void {
    const bucketObjects =
      this.objects.get(bucket) ?? new Map<string, StoredObject>();
    bucketObjects.set(key, { size, lastModified: undefined, ageDays });
    this.objects.set(bucket, bucketObjects);
  }

  keys(bucket: string): string[] {
    return [...(this.objects.get(bucket)?.keys() ?? [])].toSorted();
  }

  listBuckets(): Promise<string[]> {
    return Promise.resolve([
      ...new Set([...this.objects.keys(), ...this.lifecycles.keys()]),
    ]);
  }

  getLifecycleRules(
    bucket: string,
  ): Promise<readonly LifecycleRuleDocument[] | undefined> {
    return Promise.resolve(this.lifecycles.get(bucket));
  }

  listObjects(input: {
    bucket: string;
    prefix: string;
    token: string | undefined;
    maxKeys: number;
  }): Promise<ListedPage> {
    this.listCount += 1;
    this.listCalls.push({
      bucket: input.bucket,
      prefix: input.prefix,
      token: input.token,
    });
    if (this.failListOnCall === this.listCount) {
      this.failListOnCall = undefined;
      return Promise.reject(new Error("list failed"));
    }
    const keys = this.keys(input.bucket).filter(
      (key) =>
        (this.ignorePrefix || key.startsWith(input.prefix)) &&
        (input.token === undefined || key > input.token),
    );
    const page = keys.slice(0, this.pageSize);
    const objects: ListedObject[] = page.map((key) => {
      const stored = this.objects.get(input.bucket)?.get(key);
      return {
        key,
        size: stored?.size ?? 0,
        lastModified:
          stored?.ageDays === undefined
            ? stored?.lastModified
            : new Date(this.nowMs - stored.ageDays * MILLIS_PER_DAY),
      };
    });
    const last = page.at(-1);
    return Promise.resolve({
      objects,
      nextToken: keys.length > page.length ? last : undefined,
    });
  }

  deleteObjects(input: {
    bucket: string;
    keys: readonly string[];
  }): Promise<DeleteFailure[]> {
    this.deleteCalls.push({ bucket: input.bucket, keys: input.keys });
    const failures: DeleteFailure[] = [];
    for (const key of input.keys) {
      if (this.failDeleteKeys.has(key)) {
        failures.push({ key, code: "AccessDenied", message: "denied" });
      } else {
        this.objects.get(input.bucket)?.delete(key);
      }
    }
    return Promise.resolve(failures);
  }
}
