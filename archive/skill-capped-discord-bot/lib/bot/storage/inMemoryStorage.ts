import { Storage } from "./storage";

export class InMemoryStorage<V> implements Storage<V> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any;

  constructor() {
    this.store = {};
  }

  async set(key: string, value: V): Promise<undefined> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    this.store[key] = value;
    return Promise.resolve(undefined);
  }

  async get(key: string): Promise<V> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return Promise.resolve(this.store[key] as V);
  }
}
