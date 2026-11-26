/** Construct a class-based API model (e.g. a Kubernetes client V1* type) with the given properties. */
export function model<T extends object>(
  ctor: new () => T,
  props: Partial<T>,
): T {
  return Object.assign(new ctor(), props);
}
