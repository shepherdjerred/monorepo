import * as R from "remeda";

// run an async map operation, filtering out undefined results
export async function asyncMapFilterUndefined<T, U>(
  input: T[],
  fn: (x: T) => Promise<U | undefined>,
): Promise<U[]> {
  const results = await asyncMap(input, fn);
  return filterUndefined(results);
}

export async function asyncMap<T, U>(
  input: T[],
  fn: (x: T) => Promise<U>,
): Promise<U[]> {
  const promises = R.pipe(
    input,
    R.map((item) => fn(item)),
  );

  return Promise.all(promises);
}

export function filterUndefined<T>(input: (T | undefined)[]): T[] {
  const result: T[] = [];
  for (const item of input) {
    if (item !== undefined) {
      result.push(item);
    }
  }
  return result;
}
