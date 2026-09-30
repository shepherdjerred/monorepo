function secureEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.codePointAt(index % Math.max(left.length, 1)) ?? 0) ^
      (right.codePointAt(index % Math.max(right.length, 1)) ?? 0);
  }
  return difference === 0;
}

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function hasBearer(
  authorization: string | undefined,
  token: string,
): boolean {
  return (
    authorization !== undefined && secureEqual(authorization, `Bearer ${token}`)
  );
}
