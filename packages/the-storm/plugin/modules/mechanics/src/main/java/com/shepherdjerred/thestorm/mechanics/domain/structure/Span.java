package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;

/**
 * A bridge or door found between two signs.
 *
 * @param structure its movable blocks
 * @param farSign the sign at the other end, whose stock is pooled with this end's
 */
public record Span(Structure structure, Pos farSign) {}
