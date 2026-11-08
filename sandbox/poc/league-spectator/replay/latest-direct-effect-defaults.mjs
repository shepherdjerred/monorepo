// Defaults observed through the original registered emitter constructor and
// typed loader. Authored fields retain their values, including explicit zero.
export const DIRECT_POINT_DEFAULT_BITS = Object.freeze({
  rate: Object.freeze([0x00000000]),
  particleLifetime: Object.freeze([0x40400000]),
  birthScale0: Object.freeze([0x3f800000, 0x3f800000, 0x3f800000]),
  bindWeight: Object.freeze([0x00000000]),
  lifetime: Object.freeze([0x7f7fffff]),
});
const floats = (bits) => [...new Float32Array(new Uint32Array(bits).buffer)];
const defaults = Object.freeze({
  blendMode: 0,
  ...Object.fromEntries(
    Object.entries(DIRECT_POINT_DEFAULT_BITS).map(([name, bits]) => {
      const values = floats(bits);
      return [
        name,
        name === "lifetime"
          ? values[0]
          : Object.freeze({
              __type: values.length === 1 ? "ValueFloat" : "ValueVector3",
              constantValue:
                values.length === 1 ? values[0] : Object.freeze(values),
            }),
      ];
    }),
  ),
});

export function normalizeDirectPointEmitter(source) {
  // An explicitly invalid authored value remains invalid. Only absent numeric
  // fields receive verified constructor defaults before admission.
  return { ...defaults, ...source };
}
