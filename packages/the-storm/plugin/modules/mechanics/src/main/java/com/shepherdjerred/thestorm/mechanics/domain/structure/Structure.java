package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * The movable part of a bridge, door or gate.
 *
 * @param material the one material it is built from
 * @param template where a block of the material stays put (a bridge's end or a gate's column top),
 *     so placed blocks can copy its orientation
 * @param cells every space it fills when closed, each listed once
 */
public record Structure(String material, Pos template, List<Pos> cells) {

  public Structure {
    Cell.requireMaterialKey(material);
    // A cell listed twice would count its block twice; each space is planned once.
    cells = List.copyOf(new LinkedHashSet<>(cells));
  }
}
