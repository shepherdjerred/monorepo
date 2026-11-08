/** Validate the entire NBT stream before admitting a retained chunk. */
export function validateNbt(
  input: Uint8Array,
  chunk?: { x: number; z: number; layer: "region" | "entities" | "poi" },
): void {
  const bytes = Buffer.from(input);
  const fields = new Map<string, number[]>();
  let cursor = 0;
  const take = (count: number) => {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      cursor + count > bytes.length
    )
      throw new Error("Truncated NBT payload");
    const start = cursor;
    cursor += count;
    return start;
  };
  const byte = () => bytes.readUInt8(take(1));
  const string = () => {
    const length = bytes.readUInt16BE(take(2));
    const start = take(length);
    return bytes.toString("utf8", start, start + length);
  };
  const count = () => {
    const size = bytes.readInt32BE(take(4));
    if (size < 0) throw new Error("Negative NBT count");
    return size;
  };
  const remember = (name: string, type: number, start: number) => {
    if (chunk === undefined) return;
    if (!["DataVersion", "xPos", "zPos", "Position"].includes(name)) return;
    if (fields.has(name)) throw new Error(`Duplicate chunk field ${name}`);
    if (name !== "Position" && type === 3)
      fields.set(name, [bytes.readInt32BE(start)]);
    else if (
      name === "Position" &&
      type === 11 &&
      bytes.readInt32BE(start) === 2
    )
      fields.set(
        name,
        Array.from({ length: 2 }, (_, i) =>
          bytes.readInt32BE(start + 4 + i * 4),
        ),
      );
    else throw new Error(`Invalid chunk field ${name}`);
  };
  const payload = (tag: number, depth: number): void => {
    if (depth > 64) throw new Error("NBT nesting exceeds limit");
    switch (tag) {
      case 1:
        take(1);
        break;
      case 2:
        take(2);
        break;
      case 3:
      case 5:
        take(4);
        break;
      case 4:
      case 6:
        take(8);
        break;
      case 7:
        take(count());
        break;
      case 8:
        string();
        break;
      case 9: {
        const type = byte(),
          size = count();
        if (size > bytes.length || (type === 0 && size !== 0))
          throw new Error("Invalid NBT list");
        for (let i = 0; i < size; i++) payload(type, depth + 1);
        break;
      }
      case 10: {
        for (let type = byte(); type !== 0; type = byte()) {
          const name = string(),
            start = cursor;
          payload(type, depth + 1);
          if (depth === 0) remember(name, type, start);
        }
        break;
      }
      case 11:
        take(count() * 4);
        break;
      case 12:
        take(count() * 8);
        break;
      default:
        throw new Error(`Unknown NBT tag ${tag.toString()}`);
    }
  };
  if (byte() !== 10) throw new Error("NBT root must be a compound");
  string();
  payload(10, 0);
  if (cursor !== bytes.length) throw new Error("Trailing NBT bytes");
  if (chunk !== undefined) {
    if ((fields.get("DataVersion")?.[0] ?? 0) <= 0)
      throw new Error("Chunk lacks DataVersion");
    const coordinates =
      chunk.layer === "entities"
        ? fields.get("Position")
        : [fields.get("xPos")?.[0], fields.get("zPos")?.[0]];
    if (
      chunk.layer !== "poi" &&
      (coordinates?.length !== 2 ||
        coordinates[0] !== chunk.x ||
        coordinates[1] !== chunk.z)
    )
      throw new Error("Chunk coordinates differ from region address");
  }
}
