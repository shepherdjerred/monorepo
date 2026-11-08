/* CraftBook IC dispatch port, GNU GPL version 3 or later.
 * Upstream revision and original copyright notice: NOTICE and IntegratedCircuits.
 */
package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.ic.CircuitArea;
import com.shepherdjerred.thestorm.mechanics.domain.ic.CircuitTag.Kind;
import java.util.Optional;
import java.util.function.BiPredicate;
import java.util.function.BooleanSupplier;

/** Original edge/poll semantics; a sign without an output lever can still run a farm. */
final class FarmCircuits {
  private final CircuitAccess access;
  private final CropCircuits crops;
  private final ItemCircuits items;
  private final AnimalCircuits animals;

  FarmCircuits(CircuitAccess access) {
    this.access = access;
    crops = new CropCircuits(access);
    items = new ItemCircuits(access);
    animals = new AnimalCircuits(access);
  }

  Result<Optional<Boolean>, String> run(Kind kind, CircuitAccess.Visit visit) {
    try {
      if (kind == Kind.FIREWORK_SHOW)
        return Result.err(
            "missing original external fireworks show: " + visit.line(2) + ".txt or .fwk");
      if (!enabled(kind, visit)) return Result.ok(Optional.empty());
      var operation = operation(kind, visit);
      var result = false;
      var attempts = visit.polling() && passive(kind) ? 10 : 1;
      for (var attempt = 0; attempt < attempts; attempt++) result = operation.getAsBoolean();
      if (kind == Kind.FERTILIZER || (kind == Kind.PLANTER && visit.polling()))
        return Result.ok(Optional.empty());
      // CraftBook's doStuff() returned false even after crafting; keep its output behavior.
      return Result.ok(Optional.of(kind != Kind.CRAFTER && result));
    } catch (IllegalArgumentException error) {
      return Result.err(requireNonNull(error.getMessage()));
    }
  }

  private static boolean passive(Kind kind) {
    return switch (kind) {
      case PLANTER, CULTIVATOR, HARVESTER, FERTILIZER -> true;
      default -> false;
    };
  }

  private static boolean enabled(Kind kind, CircuitAccess.Visit visit) {
    if (!visit.polling()) return visit.input();
    if (passive(kind)) return !visit.input();
    return switch (kind) {
      case BREEDER, ANIMAL_HARVESTER -> visit.input();
      default -> true;
    };
  }

  private BooleanSupplier operation(Kind kind, CircuitAccess.Visit visit) {
    return switch (kind) {
      case PLANTER -> inArea(visit, 3, crops::plant);
      case CULTIVATOR -> inArea(visit, 2, crops::cultivate);
      case HARVESTER -> inArea(visit, 2, crops::harvest);
      case FERTILIZER -> inArea(visit, 2, crops::fertilize);
      case ANIMAL_HARVESTER -> inArea(visit, 2, animals::harvest);
      case BREEDER -> inArea(visit, 2, animals::breed);
      case CRAFTER -> () -> items.craft(visit);
      case BREAKER -> () -> items.breakBlock(visit);
      case SORTER -> () -> items.sort(visit);
      default -> throw new IllegalStateException("unexpected farm IC " + kind);
    };
  }

  private BooleanSupplier inArea(
      CircuitAccess.Visit visit,
      int line,
      BiPredicate<CircuitAccess.Visit, CircuitArea> operation) {
    var area = access.area(visit, line);
    return () -> operation.test(visit, area);
  }
}
