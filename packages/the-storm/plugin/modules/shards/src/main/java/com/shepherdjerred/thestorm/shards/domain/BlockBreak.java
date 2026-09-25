package com.shepherdjerred.thestorm.shards.domain;

/**
 * A block broken by a player, as the drop rules see it.
 *
 * @param material the Paper block material, such as {@code DEEPSLATE_DIAMOND_ORE}
 * @param world the world key, such as {@code minecraft:overworld}
 * @param placedByPlayer whether a player placed (or a piston moved) this block here
 * @param silkTouch whether the tool carries Silk Touch
 * @param dropsItems whether the break yields the block's normal drops: false in creative mode or
 *     with the wrong tool
 */
public record BlockBreak(
    String material, String world, boolean placedByPlayer, boolean silkTouch, boolean dropsItems) {}
