package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.Names;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.List;

/** Why a structure cannot be found or toggled. Each explains itself to the player. */
public sealed interface StructureProblem {

  /** The explanation shown to the player. */
  String message();

  /** A structure sign turned to a diagonal has no direction to extend in. */
  record NotSquare() implements StructureProblem {
    @Override
    public String message() {
      return "Turn the sign to face north, south, east or west.";
    }
  }

  /**
   * The block the structure grows from is missing or not allowed.
   *
   * @param where where the block belongs, such as "directly above or below the sign"
   * @param found what is there instead
   */
  record NoBase(String where, String found) implements StructureProblem {
    @Override
    public String message() {
      return "Put an allowed block "
          + where
          + " (found "
          + Names.material(found)
          + ", which can't be used).";
    }
  }

  /**
   * No matching sign at the other end within reach.
   *
   * @param tags the signs that would end the structure
   * @param maxLength the longest the structure may be
   */
  record NoFarEnd(List<String> tags, int maxLength) implements StructureProblem {
    public NoFarEnd {
      tags = List.copyOf(tags);
    }

    @Override
    public String message() {
      return "No matching " + String.join(" or ", tags) + " sign within " + maxLength + " blocks.";
    }
  }

  /** The two ends are next to each other, so there is nothing between them to move. */
  record TooShort() implements StructureProblem {
    @Override
    public String message() {
      return "The two ends are touching; leave a gap between them.";
    }
  }

  /**
   * The far end's block differs from this end's.
   *
   * @param expected this end's material
   * @param found the far end's
   */
  record EndsDiffer(String expected, String found) implements StructureProblem {
    @Override
    public String message() {
      return "Both ends must be "
          + Names.material(expected)
          + "; the other end is "
          + Names.material(found)
          + ".";
    }
  }

  /** The far end is narrower than this end. */
  record WidthsDiffer() implements StructureProblem {
    @Override
    public String message() {
      return "Both ends must be the same width.";
    }
  }

  /** No gate columns near a gate sign. */
  record NoGate(int radius) implements StructureProblem {
    @Override
    public String message() {
      return "No gate within " + radius + " blocks of this sign.";
    }
  }

  /**
   * Something that is not part of the structure fills a space it needs.
   *
   * @param pos where
   * @param material what is in the way
   */
  record Obstructed(Pos pos, String material) implements StructureProblem {
    @Override
    public String message() {
      return "It can't close: "
          + Names.material(material)
          + " is in the way at "
          + Names.pos(pos)
          + ".";
    }
  }

  /**
   * Closing needs more blocks than the signs hold, because some were taken or the ground changed.
   *
   * @param material the structure's material
   * @param needed how many closing needs
   * @param held how many the signs hold
   */
  record NotEnoughBlocks(String material, int needed, int held) implements StructureProblem {
    @Override
    public String message() {
      return "It needs "
          + Names.count(needed, material)
          + " to close but holds "
          + held
          + ". Right-click the sign with "
          + Names.material(material)
          + " to add more.";
    }
  }

  /**
   * The signs hold a different material from the structure's.
   *
   * @param stock what is held
   * @param material the structure's material
   */
  record WrongStock(Stock stock, String material) implements StructureProblem {
    @Override
    public String message() {
      return "The sign holds "
          + Names.count(stock.count(), stock.material().orElseThrow())
          + ", not "
          + Names.material(material)
          + ". Break the sign to get them back.";
    }
  }

  /** Two signs of one structure hold different materials. */
  record MixedStock(Stock first, Stock second) implements StructureProblem {
    @Override
    public String message() {
      return "Its signs hold different blocks ("
          + Names.material(first.material().orElseThrow())
          + " and "
          + Names.material(second.material().orElseThrow())
          + "). Break one to get its blocks back.";
    }
  }

  /** A deposit of the wrong material. */
  record WrongMaterial(String material, String offered) implements StructureProblem {
    @Override
    public String message() {
      return "It is built from "
          + Names.material(material)
          + ", not "
          + Names.material(offered)
          + ".";
    }
  }
}
