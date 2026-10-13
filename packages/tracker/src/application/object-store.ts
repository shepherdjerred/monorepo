export type ObjectStore = {
  put: (
    key: string,
    body: ReadableStream<Uint8Array>,
    contentType: string,
  ) => Promise<void>;
  get: (key: string) => ReadableStream<Uint8Array>;
  delete: (key: string) => Promise<void>;
};
