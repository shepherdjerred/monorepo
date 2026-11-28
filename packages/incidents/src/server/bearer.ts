function digest(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header. Both sides
 * are hashed first so the comparison runs over equal-length digests and leaks
 * neither the token's length nor its prefix.
 */
export function hasBearer(
  authorization: string | undefined,
  token: string,
): boolean {
  if (authorization === undefined) return false;
  const left = digest(authorization);
  const right = digest(`Bearer ${token}`);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |=
      (left.codePointAt(index) ?? 0) ^ (right.codePointAt(index) ?? 0);
  return difference === 0;
}
