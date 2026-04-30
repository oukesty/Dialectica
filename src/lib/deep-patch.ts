type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export type DeepPartial<T> =
  T extends Primitive ? T
    : T extends Array<infer U> ? DeepPartial<U>[]
      : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

export function mergeDeep<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (Array.isArray(patch)) return patch as T;
  if (isPlainObject(base) && isPlainObject(patch)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = key in merged ? mergeDeep(merged[key], value) : value;
    }
    return merged as T;
  }
  return patch as T;
}

export function createDeepPatch<T>(current: T, next: T): DeepPartial<T> | undefined {
  if (deepEqual(current, next)) return undefined;
  if (Array.isArray(current) && Array.isArray(next)) {
    return next as DeepPartial<T>;
  }
  if (isPlainObject(current) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
    const patch: Record<string, unknown> = {};
    for (const key of keys) {
      const nestedPatch = createDeepPatch(current[key], next[key]);
      if (nestedPatch !== undefined) {
        patch[key] = nestedPatch;
      }
    }
    return Object.keys(patch).length > 0 ? (patch as DeepPartial<T>) : undefined;
  }
  return next as DeepPartial<T>;
}

export function createPatchBase<T>(current: T, patch: DeepPartial<T> | undefined): DeepPartial<T> | undefined {
  if (patch === undefined) return undefined;
  if (Array.isArray(patch)) {
    return (Array.isArray(current) ? current : undefined) as DeepPartial<T>;
  }
  if (isPlainObject(patch)) {
    const base: Record<string, unknown> = {};
    const currentRecord = isPlainObject(current) ? current : undefined;
    for (const [key, value] of Object.entries(patch)) {
      if (currentRecord && key in currentRecord) {
        const nestedBase = createPatchBase(currentRecord[key], value);
        if (nestedBase !== undefined) {
          base[key] = nestedBase;
        }
      }
    }
    return Object.keys(base).length > 0 ? (base as DeepPartial<T>) : undefined;
  }
  return current as DeepPartial<T>;
}

export function hasDeepConflict<T>(
  current: T,
  patch: DeepPartial<T> | undefined,
  base: DeepPartial<T> | undefined,
): boolean {
  if (patch === undefined) return false;
  if (Array.isArray(patch)) {
    return !deepEqual(current, base);
  }
  if (isPlainObject(patch)) {
    if (current !== undefined && !isPlainObject(current)) {
      return !deepEqual(current, base);
    }
    const currentRecord: Record<string, unknown> = isPlainObject(current) ? current : {};
    const baseRecord: Record<string, unknown> = isPlainObject(base) ? base : {};
    return Object.entries(patch).some(([key, value]) =>
      hasDeepConflict(currentRecord[key], value, key in baseRecord ? baseRecord[key] : undefined),
    );
  }
  return !deepEqual(current, base);
}
