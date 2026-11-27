import {
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
  rotateByteLeft,
  swapAdjacentBits,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

// Storage constants selected by the current executable's opcode 80 reader.
const implicitTransition = [
  null,
  null,
  0xe7a10404,
  null,
  0x01040404,
  0x04040404,
  0xa9a10404,
  null,
];

/** Translate the specified current opcode 80 body and native consumer fields. */
export function createCurrentMap11ControllerReader(replay, codecs) {
  if (
    replay?.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol
  )
    throw Error(
      "Map11 controller reads require the exact current replay layout",
    );
  const substitution = recoverTerrainByteSubstitution(codecs);
  const nameByte = (wire) =>
    ((swapAdjacentBits(substitution[wire]) ^ 0xb0) + 4) & 0xff;
  const transitionByte = (wire) =>
    swapAdjacentBits(
      rotateByteLeft(
        substitution[(rotateByteLeft((wire + 0x3e) & 0xff, 5) + 0x5f) & 0xff] ^
          3,
        2,
      ),
    );
  const float = new DataView(new ArrayBuffer(4));

  return (payload) => {
    if (!(payload instanceof Uint8Array) || payload.length === 0)
      throw Error("Truncated Map11 controller body");
    const [header] = payload;
    let offset = 1;
    const take = () => {
      if (offset >= payload.length)
        throw Error("Truncated Map11 controller field");
      return payload[offset++];
    };
    const implicit = implicitTransition[header & 7];
    let transitionBits = 0;
    for (let index = 0; index < 4; index++) {
      if (implicit === null)
        transitionBits = (transitionBits << 8) | transitionByte(take());
      else
        transitionBits |=
          transitionByte((implicit >>> (index * 8)) & 0xff) << (index * 8);
    }
    float.setUint32(0, transitionBits);
    const transition = float.getFloat32(0);
    let name = 0;
    if (header & 8) {
      let terminated = false;
      for (let index = 0; index < 5; index++) {
        const byte = nameByte(take());
        name += (byte & 0x7f) * 2 ** (index * 7);
        if (byte < 0x80) {
          terminated = true;
          break;
        }
      }
      if (!terminated || name > 0xffffffff)
        throw Error("Invalid Map11 controller name varint");
    } else {
      name = nameByte(0xf8) * 0x01010101;
    }
    if (offset !== payload.length)
      throw Error("Trailing bytes in Map11 controller body");
    const storedVisible = header & 16 ? 0xe0 : 0x58;
    const visible = Boolean(
      substitution[
        (substitution[(0x5b - storedVisible) & 0xff] + 0xfa) & 0xff
      ] & 2,
    );
    return { name, visible, transition };
  };
}
