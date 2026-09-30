package com.shepherdjerred.thestorm.towns.domain.world;

/** Something the world does from one position to another, with no player directly acting. */
public enum WorldEffect {
  /** A piston pushing or pulling blocks. */
  PISTON,
  /** Water or lava flowing, or a dragon egg teleporting. */
  FLUID_FLOW,
  /** Hoppers, droppers, crafters, hopper minecarts and copper golems moving items. */
  ITEM_TRANSFER,
  /**
   * A dispenser or dropper acting on the block in front of it: fluids, fire, shears, bone meal,
   * armor, dropped items.
   */
  DISPENSE,
  /** A tree, huge mushroom or other structure growing. */
  TREE_GROWTH,
  /** Bone meal spreading grass, flowers or moss around the fertilized block. */
  BONEMEAL_SPREAD,
  /** Sculk spreading from a catalyst. */
  SCULK_SPREAD,
  /** Vines, mushrooms, grass, mycelium and similar blocks spreading. */
  BLOCK_SPREAD,
  /** TNT, creepers, end crystals, beds, respawn anchors, wind charges, fireballs, withers. */
  EXPLOSION,
  /** Fire spreading or being lit by lava, lightning or other fire. */
  FIRE_SPREAD,
  /** Fire destroying a block. */
  FIRE_BURN,
  /** Endermen, ravagers, withers, silverfish and zombies changing blocks. */
  MOB_GRIEF,
  /** Sand, gravel, anvils and other falling blocks landing. */
  FALLING_BLOCK,
  /** A projectile from a mob or dispenser hitting a target, button, pot or dripstone. */
  PROJECTILE_IMPACT,
  /** Redstone power reaching a door, trapdoor or fence gate. */
  REDSTONE,
  /** A portal generated for a player arriving from another dimension. */
  PORTAL_CREATION,
}
