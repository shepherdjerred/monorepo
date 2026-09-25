package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.Optional;

/**
 * What a structure sign was bound to when it was written. On every use the structure is checked
 * against this and refused if it no longer matches; a sign never re-targets another structure.
 */
public sealed interface Binding {

  /** The structure's one material. */
  String material();

  /**
   * One end of a bridge or door.
   *
   * @param material the structure's material
   * @param anchor this end's base block
   * @param partner the other end's sign, once both ends are written
   * @param keeper whether this end's sign holds the structure's stock; exactly one linked end does
   */
  record SpanEnd(String material, Pos anchor, Optional<Pos> partner, boolean keeper)
      implements Binding {

    public SpanEnd {
      Cell.requireMaterialKey(material);
    }
  }

  /**
   * A gate sign and the columns it was built with.
   *
   * @param gate the column tops and material
   */
  record GateFrame(Gate gate) implements Binding {

    @Override
    public String material() {
      return gate.material();
    }
  }
}
