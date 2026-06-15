import { Serializer } from "./serializer";

export class JsonSerializer<V> implements Serializer<V> {
  serialize(value: V): string {
    return JSON.stringify(value);
  }
  deserialize(blob: string): V {
    return JSON.parse(blob) as V;
  }
}
