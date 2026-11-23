import { createUnicornByteIo } from "./unicorn-byte-io.mjs";

// Differential-only host API adapter. Original emulation, registers, hooks and
// memory mappings remain the pinned runtime's own implementation.
export function wrapUnicornByteIo(uc) {
  function Unicorn(...args) {
    const engine = new uc.Unicorn(...args),
      io = createUnicornByteIo(uc, engine);
    const close = engine.close.bind(engine);
    engine.mem_read = io.read;
    engine.mem_write = io.write;
    engine.close = () => {
      try {
        return close();
      } finally {
        io.close();
      }
    };
    return engine;
  }
  Unicorn.prototype = uc.Unicorn.prototype;
  Object.setPrototypeOf(Unicorn, uc.Unicorn);
  const descriptors = Object.getOwnPropertyDescriptors(uc);
  descriptors.Unicorn = { ...descriptors.Unicorn, value: Unicorn };
  return Object.defineProperties(
    Object.create(Object.getPrototypeOf(uc)),
    descriptors,
  );
}
