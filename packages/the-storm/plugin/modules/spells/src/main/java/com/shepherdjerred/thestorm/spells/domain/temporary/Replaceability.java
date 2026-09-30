package com.shepherdjerred.thestorm.spells.domain.temporary;

/**
 * Which blocks a temporary block may stand in for. The list is an allowlist: only empty space, soft
 * plants and (for Freeze) still water. Containers, block entities, multi-block structures, ores and
 * every other block are never replaced, so nothing a player owns is ever displaced and no item can
 * drop.
 */
public final class Replaceability {

  private Replaceability() {}

  /** What a spell wants to replace. */
  public enum Mode {
    /** Walls, tombs and platforms: air and soft plants. */
    OPEN_SPACE,
    /** Freeze: still water only. */
    WATER
  }

  public static boolean canReplace(BlockFacts facts, Mode mode) {
    if (facts.blockEntity() || facts.multiBlock()) {
      return false;
    }
    return switch (mode) {
      case OPEN_SPACE ->
          facts.kind() == BlockFacts.Kind.AIR || facts.kind() == BlockFacts.Kind.SOFT;
      case WATER -> facts.kind() == BlockFacts.Kind.WATER_SOURCE;
    };
  }
}
