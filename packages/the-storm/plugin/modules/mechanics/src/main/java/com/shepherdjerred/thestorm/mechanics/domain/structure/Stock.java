package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import java.util.Optional;

/**
 * Blocks a structure's sign holds while the structure is open. Only one material at a time.
 *
 * @param material what is held, empty when nothing is
 * @param count how many
 */
public record Stock(Optional<String> material, int count) {

  public Stock {
    if (count < 0) {
      throw new IllegalArgumentException("stock must not be negative: " + count);
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
  public static Stock of(String material, int count) {
    return count == 0 ? empty() : new Stock(Optional.of(material), count);
  }

  public boolean isEmpty() {
    return count == 0;
  }

  /** Whether blocks of {@code other} may be added to or taken from this stock. */
  public boolean accepts(String other) {
    return material.map(other::equals).orElse(true);
  }

  /** This stock with {@code added} more blocks of {@code of}. */
  public Stock plus(String of, int added) {
    if (!accepts(of)) {
      throw new IllegalArgumentException("cannot add " + of + " to a stock of " + material);
    }
    return of(of, count + added);
  }

  /** This stock with {@code taken} fewer blocks. */
  public Stock minus(int taken) {
    if (taken > count) {
      throw new IllegalArgumentException("cannot take " + taken + " from " + count);
    }
    return count == taken ? empty() : new Stock(material, count - taken);
  }

  /** Both stocks pooled into one, or a problem if they hold different materials. */
  public Result<Stock, StructureProblem> merge(Stock other) {
    if (other.isEmpty()) {
      return Result.ok(this);
    }
    var otherMaterial = other.material().orElseThrow();
    if (!accepts(otherMaterial)) {
      return Result.err(new StructureProblem.MixedStock(this, other));
    }
    return Result.ok(plus(otherMaterial, other.count()));
  }
}
