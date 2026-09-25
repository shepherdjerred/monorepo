package com.shepherdjerred.thestorm.towns.domain.protection;

/**
 * What an {@link Action} is done to. Admin regions allow actions per subject, for example opening
 * doors but not chests at spawn.
 */
public enum Subject {
  DOOR,
  TRAPDOOR,
  FENCE_GATE,
  BUTTON,
  LEVER,
  PRESSURE_PLATE,
  TRIPWIRE,
  BELL,
  BED,
  RESPAWN_ANCHOR,
  ANVIL,
  CONTAINER,
  LECTERN,
  SIGN,
  CAKE,
  REDSTONE_COMPONENT,
  FARMLAND,
  /** Any other block. */
  BLOCK,
  PLAYER,
  VEHICLE,
  ANIMAL,
  VILLAGER,
  ITEM_FRAME,
  ARMOR_STAND,
  /** Any other entity. */
  ENTITY,
  /** A teleport by ender pearl. */
  ENDER_PEARL,
  /** A teleport by chorus fruit. */
  CHORUS_FRUIT,
  /** A place, for teleports by command, spell or warp and for homes. */
  LOCATION,
  /**
   * Only in region config: the allowance covers every subject. Listeners never report it as the
   * subject of an act.
   */
  ANY,
}
