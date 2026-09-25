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
   * A gate sign and the columns it was built with. A second gate sign with the same columns links
   * to the first, like a bridge's two ends; then exactly one of the two keeps the stock.
   *
   * @param gate the column tops and material
   * @param partner the other gate sign for the same columns, if one is linked
   * @param keeper whether this sign holds the gate's stock (always, when it has no partner)
   */
  record GateFrame(Gate gate, Optional<Pos> partner, boolean keeper) implements Binding {

    public GateFrame {
      if (partner.isEmpty() && !keeper) {
        throw new IllegalArgumentException("a gate sign on its own keeps its stock");
      }
    }

    @Override
    public String material() {
      return gate.material();
    }
  }
}
