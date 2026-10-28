package com.shepherdjerred.thestorm.qol.domain.bank;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * A bank as it is stored: the sign, the container, who else may use it, and its shelves. Items stay
 * in the containers.
 *
 * @param id stable id
 * @param owner who created it
 * @param sign where the {@code [Bank]} sign is
 * @param container the container the sign serves
 * @param grants players other than the owner, and what each may do
 * @param shelves the linked containers, in the order items are offered to them
 */
public record StoredBank(
    String id,
    UUID owner,
    Spot sign,
    Spot container,
    Map<UUID, BankRole> grants,
    List<StoredShelf> shelves) {

  public StoredBank {
    grants = Map.copyOf(grants);
    shelves = List.copyOf(shelves);
    if (id.isBlank()) {
      throw new IllegalArgumentException("a bank needs an id");
    }
  }

  /** The shelf whose sign or container is {@code spot}. */
  public Optional<StoredShelf> shelfAt(Spot spot) {
    return shelves.stream()
        .filter(
            shelf ->
                shelf.sign().isAt(spot.world(), spot.x(), spot.y(), spot.z())
                    || shelf.container().isAt(spot.world(), spot.x(), spot.y(), spot.z()))
        .findFirst();
  }

  /** A block position. */
  public record Spot(String world, int x, int y, int z) {

    public Spot {
      if (world.isBlank()) {
        throw new IllegalArgumentException("a spot needs a world");
      }
    }

    public boolean isAt(String world, int x, int y, int z) {
      return this.world.equals(world) && this.x == x && this.y == y && this.z == z;
    }
  }

  /**
   * One shelf.
   *
   * @param restack whether partial stacks of an accepted item are combined up to the vanilla limit
   * @param materials the item keys this shelf accepts, such as {@code minecraft:stone}
   */
  public record StoredShelf(
      String id, Spot sign, Spot container, boolean restack, Set<String> materials) {

    public StoredShelf {
      materials = Set.copyOf(materials);
      if (id.isBlank()) {
        throw new IllegalArgumentException("a shelf needs an id");
      }
    }
  }

  /** A copy whose shelf with the same id is replaced. */
  public StoredBank withShelfReplaced(StoredShelf shelf) {
    var next = new java.util.ArrayList<StoredShelf>();
    var found = false;
    for (var existing : shelves) {
      if (existing.id().equals(shelf.id())) {
        next.add(shelf);
        found = true;
      } else {
        next.add(existing);
      }
    }
    if (!found) {
      throw new IllegalArgumentException("no shelf " + shelf.id());
    }
    return new StoredBank(id, owner, sign, container, grants, next);
  }

  /** A copy with {@code shelf} appended. */
  public StoredBank withShelf(StoredShelf shelf) {
    var next = new java.util.ArrayList<>(shelves);
    next.add(shelf);
    return new StoredBank(id, owner, sign, container, grants, next);
  }

  /** A copy without the shelf {@code shelfId}. */
  public StoredBank withoutShelf(String shelfId) {
    return new StoredBank(
        id,
        owner,
        sign,
        container,
        grants,
        shelves.stream().filter(shelf -> !shelf.id().equals(shelfId)).toList());
  }

  /** A copy whose grants include {@code player} at {@code role}. */
  public StoredBank withGrant(UUID player, BankRole role) {
    var next = new java.util.HashMap<>(grants);
    next.put(player, role);
    return new StoredBank(id, owner, sign, container, next, shelves);
  }

  /** A copy that no longer grants {@code player} anything. */
  public StoredBank withoutGrant(UUID player) {
    var next = new java.util.HashMap<>(grants);
    next.remove(player);
    return new StoredBank(id, owner, sign, container, next, shelves);
  }
}
