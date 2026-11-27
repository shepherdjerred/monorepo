import {
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { createCurrentInventorySnapshotReader } from "./native-terrain-inventory-assignment-reader.mjs";
import { createCurrentInventoryItemReader } from "./native-terrain-inventory-item-reader.mjs";
import { createCurrentInventorySlotReader } from "./native-terrain-inventory-slot-reader.mjs";

export function createCurrentInventoryPacketReader(replay, codecs) {
  if (
    replay?.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol
  )
    throw Error("Inventory packets require the exact current replay build");
  const substitution = recoverTerrainByteSubstitution(codecs);
  const readAssignment = createCurrentInventoryItemReader(substitution);
  const readSnapshot = createCurrentInventorySnapshotReader(substitution);
  const readSlot = createCurrentInventorySlotReader(substitution);
  return (opcode, body) => {
    switch (opcode) {
      case 190:
      case 840:
        return readAssignment(opcode, body);
      case 415:
      case 1214:
        return readSnapshot(opcode, body);
      case 226:
      case 248:
      case 797:
      case 1143:
        return readSlot(opcode, body);
      default:
        throw Error("Unverified current inventory opcode");
    }
  };
}
