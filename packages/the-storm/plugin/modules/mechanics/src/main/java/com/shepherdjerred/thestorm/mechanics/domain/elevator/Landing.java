package com.shepherdjerred.thestorm.mechanics.domain.elevator;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;

/**
 * Where a lift puts a player.
 *
 * @param feet the block the player's feet end up in; the block below is solid and this block and
 *     the one above are clear
 * @param sign the lift sign of the floor reached
 */
public record Landing(Pos feet, Pos sign) {}
