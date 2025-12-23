export interface Storage<V> {
  set: (key: string, value: V) => Promise<undefined>;
  get: (key: string) => Promise<V>;
}
