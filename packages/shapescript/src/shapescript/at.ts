// Indexing for positions the surrounding code has already bounded: a
// triangle's three corners, the first of a list that was checked non-empty,
// the next point of a closed ring. `items[index]` is typed `T | undefined`
// under `noUncheckedIndexedAccess`; this answers `T`, and throws if the index
// is not one after all, so a wrong index fails where it happens rather than
// passing `undefined` into geometry.

export function at<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined)
    throw new RangeError(`Index ${index} is outside 0..${items.length - 1}`);
  return item;
}

/** A value the surrounding code has just ensured — a bounding box right after
 *  `computeBoundingBox()`, the entry a map lookup has just set. Answers it,
 *  or throws naming `what` if it is missing after all. */
export function defined<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null)
    throw new Error(`Internal error: ${what} is missing`);
  return value;
}

/** A triangle's three corners. */
export type Triangle<T> = [T, T, T];

/** The first three entries of `items`, as a triangle. */
export function triangleOf<T>(items: ArrayLike<T>): Triangle<T> {
  return [at(items, 0), at(items, 1), at(items, 2)];
}
