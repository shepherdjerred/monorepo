package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;

/**
 * A bridge or door found between two signs.
 *
 * @param structure its movable blocks; the template is this end's base block
 * @param farSign the sign at the other end
 * @param farBase the other end's base block
 */
public record Span(Structure structure, Pos farSign, Pos farBase) {}
