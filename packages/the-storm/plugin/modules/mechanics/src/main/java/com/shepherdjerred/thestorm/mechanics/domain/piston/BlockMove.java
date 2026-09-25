package com.shepherdjerred.thestorm.mechanics.domain.piston;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;

/**
 * One block a super piston moves. The destination is free when the move is applied in plan order.
 *
 * @param from where the block is
 * @param to where it goes; {@code from} is left empty
 */
public record BlockMove(Pos from, Pos to) {}
