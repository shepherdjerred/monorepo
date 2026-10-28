package com.shepherdjerred.thestorm.qol.domain.bank;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Moves stacks from a bank into the first shelf that accepts them and has room. Anything a shelf
 * does not take stays in the bank. The item count is unchanged: every move is a portion of an
 * existing stack.
 */
public final class Shelving {

  private Shelving() {}

  /**
   * One stack sitting in the bank.
   *
   * @param material the item type's key, such as {@code minecraft:oak_log}
   * @param amount how many
   * @param maxStack how many of this item fit in one slot
   * @param index where the stack was
   */
  public record Pile(String material, int amount, int maxStack, int index) {

    public Pile {
      if (material.isBlank()) {
        throw new IllegalArgumentException("a pile needs a material");
      }
      if (amount < 1 || maxStack < 1 || index < 0) {
        throw new IllegalArgumentException(
            "amount, maxStack and index must be positive: "
                + amount
                + ", "
                + maxStack
                + ", "
                + index);
      }
    }
  }

  /**
   * Room in one shelf.
   *
   * @param id which shelf
   * @param materials the item keys this shelf accepts
   * @param emptySlots slots with nothing in them
   * @param partialRoom remaining space in a stack that is already this item, keyed by material
   */
  public record ShelfOpening(
      String id, Set<String> materials, int emptySlots, Map<String, Integer> partialRoom) {

    public ShelfOpening {
      materials = Set.copyOf(materials);
      partialRoom = Map.copyOf(partialRoom);
      if (id.isBlank()) {
        throw new IllegalArgumentException("a shelf needs an id");
      }
      if (emptySlots < 0) {
        throw new IllegalArgumentException("emptySlots must not be negative: " + emptySlots);
      }
      if (partialRoom.values().stream().anyMatch(room -> room < 0)) {
        throw new IllegalArgumentException("partial room must not be negative");
      }
    }
  }

  /**
   * A portion of a bank stack that moves.
   *
   * @param pileIndex {@link Pile#index()}
   * @param shelfId which shelf receives it
   * @param amount how many
   */
  public record Move(int pileIndex, String shelfId, int amount) {

    public Move {
      if (pileIndex < 0 || amount < 1 || shelfId.isBlank()) {
        throw new IllegalArgumentException("a move needs a pile, a shelf and a positive amount");
      }
    }
  }

  /** The moves that empty as much of {@code piles} as {@code shelves} can hold, in shelf order. */
  public static List<Move> plan(List<Pile> piles, List<ShelfOpening> shelves) {
    var rooms = new ArrayList<Room>();
    for (var shelf : shelves) {
      rooms.add(new Room(shelf));
    }
    var moves = new ArrayList<Move>();
    for (var pile : piles) {
      var left = pile.amount();
      for (var room : rooms) {
        if (left == 0) {
          break;
        }
        if (!room.materials.contains(pile.material())) {
          continue;
        }
        var space = room.space(pile.material(), pile.maxStack());
        var take = Math.min(left, space);
        if (take == 0) {
          continue;
        }
        room.take(pile.material(), take, pile.maxStack());
        moves.add(new Move(pile.index(), room.id, take));
        left -= take;
      }
    }
    return List.copyOf(moves);
  }

  private static final class Room {

    private final String id;
    private final Set<String> materials;
    private int emptySlots;
    private final Map<String, Integer> partialRoom;

    private Room(ShelfOpening opening) {
      this.id = opening.id();
      this.materials = opening.materials();
      this.emptySlots = opening.emptySlots();
      this.partialRoom = new HashMap<>(opening.partialRoom());
    }

    private int space(String material, int maxStack) {
      return partialRoom.getOrDefault(material, 0) + emptySlots * maxStack;
    }

    private void take(String material, int amount, int maxStack) {
      var partial = partialRoom.getOrDefault(material, 0);
      var fromPartial = Math.min(partial, amount);
      partialRoom.put(material, partial - fromPartial);
      var rest = amount - fromPartial;
      if (rest == 0) {
        return;
      }
      var slots = (rest + maxStack - 1) / maxStack;
      emptySlots -= slots;
      var remainder = rest % maxStack;
      if (remainder != 0) {
        partialRoom.put(material, maxStack - remainder);
      }
    }
  }
}
