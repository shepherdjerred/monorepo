export interface Serializer<V> {
  serialize: (value: V) => string;
  deserialize: (blob: string) => V;
}
