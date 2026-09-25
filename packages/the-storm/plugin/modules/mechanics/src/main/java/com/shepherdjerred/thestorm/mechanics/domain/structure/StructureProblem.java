package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.Names;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.List;

/** Why a structure cannot be built, found or toggled. Each explains itself to the player. */
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
   * A block of the structure holds up something else (a sign, torch, lever, rail, painting...),
   * which would break off if the block moved.
   *
   * @param pos the supporting block
   */
  record Supports(Pos pos) implements StructureProblem {
    @Override
    public String message() {
      return "The block at "
          + Names.pos(pos)
          + " holds up something that would break off. Move it first.";
    }
  }

  /**
   * Closing needs more blocks than the sign holds, because some were taken or the ground changed.
   *
   * @param material the structure's material
   * @param needed how many closing needs
   * @param held how many the sign holds
   */
  record NotEnoughBlocks(String material, long needed, long held) implements StructureProblem {
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
   * The sign holds a different material from the structure's.
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

  /** The sign cannot hold any more. */
  record StockFull() implements StructureProblem {
    @Override
    public String message() {
      return "The sign can't hold that many blocks.";
    }
  }

  /** A structure sign holding blocks is rewritten; it must be emptied (broken) first. */
  record HoldsStock(Stock stock) implements StructureProblem {
    @Override
    public String message() {
      return "This sign holds "
          + Names.count(stock.count(), stock.material().orElseThrow())
          + ". Break it to get them back before rewriting it.";
    }
  }

  /** A sign with no structure bound to it: written before The Storm, or never validated. */
  record NotBound() implements StructureProblem {
    @Override
    public String message() {
      return "This sign isn't set up yet. Sneak and right-click it with an empty hand, then press"
          + " Done to set it up.";
    }
  }

  /** A bridge or door end whose other end has not been built yet. */
  record NotLinked(String tags) implements StructureProblem {
    @Override
    public String message() {
      return "This end isn't linked yet. Write a " + tags + " sign at the other end.";
    }
  }

  /** The other end's sign is gone, rewritten or linked elsewhere. */
  record PartnerMissing(Pos partner) implements StructureProblem {
    @Override
    public String message() {
      return "The sign at the other end ("
          + Names.pos(partner)
          + ") is missing or was rewritten. Rewrite this sign to link the ends again.";
    }
  }

  /** The sign found at the other end was never set up, so it cannot be linked. */
  record FarNotSetUp(Pos far) implements StructureProblem {
    @Override
    public String message() {
      return "The sign at the other end ("
          + Names.pos(far)
          + ") isn't set up. Sneak and right-click it, press Done, then write this sign again.";
    }
  }

  /** The sign found at the other end is already linked to a different, living end. */
  record FarTaken(Pos far) implements StructureProblem {
    @Override
    public String message() {
      return "The sign at the other end (" + Names.pos(far) + ") already belongs to another one.";
    }
  }

  /** The structure no longer matches what its sign was bound to. */
  record Changed(String what) implements StructureProblem {
    @Override
    public String message() {
      return "It has changed since it was built (" + what + "). Rewrite its sign to rebuild it.";
    }
  }
}
