// Decoder for the Gen-3 proprietary text encoding (western charmap subset),
// used for Pokémon nicknames. See pokeemerald charmap.txt.

const EOS = 0xff;

const CHARMAP = new Map<number, string>([
  [0x00, " "],
  [0xab, "!"],
  [0xac, "?"],
  [0xad, "."],
  [0xae, "-"],
  [0xb0, "…"],
  [0xb1, "“"],
  [0xb2, "”"],
  [0xb3, "‘"],
  [0xb4, "’"],
  [0xb5, "♂"],
  [0xb6, "♀"],
  [0xb8, ","],
  [0xba, "/"],
  [0xf0, ":"],
]);

// '0'-'9' at 0xA1, 'A'-'Z' at 0xBB, 'a'-'z' at 0xD5.
for (let i = 0; i < 10; i++)
  CHARMAP.set(0xa1 + i, String.fromCodePoint(48 + i));
for (let i = 0; i < 26; i++)
  CHARMAP.set(0xbb + i, String.fromCodePoint(65 + i));
for (let i = 0; i < 26; i++)
  CHARMAP.set(0xd5 + i, String.fromCodePoint(97 + i));

export function decodeGameText(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === EOS) break;
    out += CHARMAP.get(byte) ?? "?";
  }
  return out;
}
