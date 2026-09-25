package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import java.util.Optional;

/**
 * Blocks a structure's sign holds while the structure is open. Only one material at a time, and
 * never more than {@link #MAX}.
 *
 * @param material what is held, empty when nothing is
 * @param count how many
 */
public record Stock(Optional<String> material, long count) {

  /** The most blocks one sign may hold; deposits beyond it are refused. */
  public static final long MAX = 1_000_000L;

  public Stock {
    if (count < 0 || count > MAX) {
      throw new IllegalArgumentException("stock must be between 0 and " + MAX + ": " + count);
    }
    if (material.isPresent() != (count > 0)) {
      throw new IllegalArgumentException(
          "stock names a material exactly when it holds blocks: " + material + " x" + count);
    }
    material.ifPresent(Cell::requireMaterialKey);
  }

  public static Stock empty() {
    return new Stock(Optional.empty(), 0);
  }

  /** {@code count} blocks of {@code material}; an empty stock when {@code count} is 0. */
  public static Stock of(String material, long count) {
    return count == 0 ? empty() : new Stock(Optional.of(material), count);
  }

  public boolean isEmpty() {
    return count == 0;
  }

  /** Whether blocks of {@code other} may be added to or taken from this stock. */
  public boolean accepts(String other) {
    return material.map(other::equals).orElse(true);
  }

  /** Whether {@code added} more blocks still fit under {@link #MAX}. */
  public boolean hasRoomFor(long added) {
    return added <= MAX - count;
  }

  /** This stock with {@code added} more blocks of {@code of}. */
  public Stock plus(String of, long added) {
    if (!accepts(of)) {
      throw new IllegalArgumentException("cannot add " + of + " to a stock of " + material);
    }
    return of(of, Math.addExact(count, added));
  }

  /** This stock with {@code taken} fewer blocks. */
  public Stock minus(long taken) {
    if (taken > count) {
      throw new IllegalArgumentException("cannot take " + taken + " from " + count);
    }
    return count == taken ? empty() : new Stock(material, count - taken);
  }
}
