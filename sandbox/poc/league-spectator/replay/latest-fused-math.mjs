// Exact finite binary32/binary64 fused multiply-add, round-to-nearest/even.
// BigInt retains the complete product and aligned addend before one rounding.
export function fusedFloatBits(a, b, c, width) {
  if (
    ![32, 64].includes(width) ||
    [a, b, c].some(
      (v) => typeof v !== "bigint" || v < 0n || v >= 1n << BigInt(width),
    )
  )
    throw Error("FMA requires bounded binary32/binary64 operand bits");
  const fractionBits = width === 32 ? 23 : 52,
    exponentBits = width === 32 ? 8 : 11,
    bias = width === 32 ? 127 : 1023,
    minimum = 1 - bias,
    maximum = bias,
    signBit = 1n << BigInt(width - 1),
    fractionMask = (1n << BigInt(fractionBits)) - 1n,
    exponentMask = (1 << exponentBits) - 1;
  const unpack = (bits) => {
    const exponent = Number(
        (bits >> BigInt(fractionBits)) & BigInt(exponentMask),
      ),
      negative = !!(bits & signBit);
    if (exponent === exponentMask)
      throw Error("Non-finite FMA operands require another ISA contract");
    const significand =
      (bits & fractionMask) | (exponent ? 1n << BigInt(fractionBits) : 0n);
    return {
      integer: negative ? -significand : significand,
      exponent: (exponent ? exponent - bias : minimum) - fractionBits,
      negative,
    };
  };
  const x = unpack(a),
    y = unpack(b),
    z = unpack(c),
    product = x.integer * y.integer,
    productExponent = x.exponent + y.exponent,
    exponent = Math.min(productExponent, z.exponent),
    sum =
      (product << BigInt(productExponent - exponent)) +
      (z.integer << BigInt(z.exponent - exponent));
  if (sum === 0n)
    return product === 0n &&
      z.integer === 0n &&
      x.negative !== y.negative &&
      z.negative
      ? signBit
      : 0n;
  const negative = sum < 0n,
    absolute = negative ? -sum : sum;
  let top = absolute.toString(2).length - 1 + exponent;
  const unit = Math.max(top, minimum) - fractionBits,
    shift = unit - exponent;
  let significand;
  if (shift <= 0) significand = absolute << BigInt(-shift);
  else {
    significand = absolute >> BigInt(shift);
    const remainder = absolute - (significand << BigInt(shift)),
      half = 1n << BigInt(shift - 1);
    if (remainder > half || (remainder === half && significand & 1n))
      significand++;
  }
  const sign = negative ? signBit : 0n,
    hidden = 1n << BigInt(fractionBits);
  if (top < minimum) {
    if (significand < hidden) return sign | significand;
    top = minimum;
  }
  if (significand >= hidden * 2n) {
    significand >>= 1n;
    top++;
  }
  if (top > maximum)
    return sign | (BigInt(exponentMask) << BigInt(fractionBits));
  return (
    sign | (BigInt(top + bias) << BigInt(fractionBits)) | (significand - hidden)
  );
}
