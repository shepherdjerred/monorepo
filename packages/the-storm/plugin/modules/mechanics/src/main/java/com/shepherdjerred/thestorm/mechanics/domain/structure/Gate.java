package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.List;

/**
 * A gate's fixed frame: the column tops that always stay.
 *
 * @param material the columns' material
 * @param anchor the column top nearest the sign; placed blocks copy its orientation
 * @param tops every column top, nearest the sign first
 */
public record Gate(String material, Pos anchor, List<Pos> tops) {

  public Gate {
    Cell.requireMaterialKey(material);
    tops = List.copyOf(tops);
    if (!tops.contains(anchor)) {
      throw new IllegalArgumentException("the anchor must be one of the tops: " + anchor);
    }
  }
}
