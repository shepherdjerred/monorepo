package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.Cooldowns;
import com.shepherdjerred.thestorm.mechanics.domain.Names;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import com.shepherdjerred.thestorm.mechanics.domain.structure.SignRecord;
import com.shepherdjerred.thestorm.mechanics.domain.structure.SignRecords;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructureBinder;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructurePlan;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructureProblem;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructureToggle;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Target;
import java.time.Duration;
import java.time.InstantSource;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.block.Sign;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * Bridges, doors and gates, bound to their structure when their sign is written (see {@link
 * StructureBinder}). A toggle acts with the sign creator's land rights over every cell, stores the
 * new stock on the one sign that keeps it before touching the world, and never moves a block that
 * holds anything up, so nothing can pop off mid-toggle.
 */
final class Structures {

  private static final long MILLIS_PER_TICK = 50;

  private final Kit kit;
  private final StructureBinder binder;
  private final InstantSource time;
  private final Cooldowns<Key> cooldowns;

  /** A structure, by the world and position of the sign that keeps its stock. */
  private record Key(UUID world, Pos keeper) {}

  Structures(Kit kit, InstantSource time) {
    this.kit = kit;
    this.binder = new StructureBinder(kit.config());
    this.time = time;
    this.cooldowns =
        new Cooldowns<>(Duration.ofMillis(kit.config().structureCooldownTicks() * MILLIS_PER_TICK));
  }

  /**
   * A structure sign being written or used.
   *
   * @param grid its world
   * @param sign where it is
   * @param view what it reads
   */
  record Use(PaperGrid grid, Pos sign, SignView view) {

    Mechanism mechanism() {
      return view.mechanism().orElseThrow();
    }

    StructureBinder.Site site(SignRecords records) {
      return new StructureBinder.Site(grid, records, sign, view);
    }
  }

  /** The world's signs, read from their persistent data. */
  private SignRecords records(PaperGrid grid) {
    return pos -> {
      if (!grid.loaded(pos) || !(grid.block(pos).getState(false) instanceof Sign sign)) {
        return Optional.empty();
      }
      var view = PaperGrid.view(grid.block(pos), PaperGrid.frontLines(sign));
      return Optional.of(
          new SignRecord(view.mechanism(), kit.signs().binding(sign), kit.signs().stock(sign)));
    };
  }

  /**
   * Checks a structure sign being written by {@code creator} and returns the bindings to store once
   * it is accepted. The creator must be allowed to break and build every cell of the structure and
   * to build at the other end's sign, which is rewritten to link.
   */
  Result<Runnable, Component> prepare(UUID creator, Use use) {
    var grid = use.grid();
    return binder
        .bind(use.site(records(grid)))
        .mapError(Structures::explain)
        .flatMap(
            bind -> {
              var rights = kit.guard().cells(creator, grid, bind.cells());
              for (var write : bind.writes()) {
                if (rights.isAllowed() && !write.sign().equals(use.sign())) {
                  rights = kit.guard().check(creator, ProtectedAction.BUILD, grid, write.sign());
                }
              }
              if (rights instanceof Decision.Denied(var reason)) {
                return Result.err(reason);
              }
              return Result.ok(
                  () ->
                      bind.writes()
                          .forEach(
                              write -> {
                                var sign = sign(grid, write.sign());
                                kit.signs().setBinding(sign, write.binding());
                                update(sign);
                              }));
            });
  }

  /** A right-click: add the held blocks if they are the structure's, otherwise toggle it. */
  void click(Player player, Use use, UUID owner) {
    var feature = use.mechanism().feature();
    var held = player.getInventory().getItemInMainHand();
    var bound = binder.resolve(use.site(records(use.grid()))).mapError(Structures::explain);
    var outcome =
        bound.flatMap(
            structure ->
                !held.isEmpty()
                        && PaperGrid.key(held.getType()).equals(structure.structure().material())
                    ? deposit(use.grid(), structure.keeper(), held)
                    : toggle(owner, use, structure, Target.TOGGLE).map(Structures::describe));
    switch (outcome) {
      case Result.Ok<String, Component>(var message) -> Replies.info(player, feature, message);
      case Result.Err<String, Component>(var reason) -> Replies.error(player, feature, reason);
    }
  }

  /** Moves the structure {@code use}'s sign controls toward {@code target}, as {@code owner}. */
  Result<StructurePlan, Component> toggle(UUID owner, Use use, Target target) {
    return binder
        .resolve(use.site(records(use.grid())))
        .mapError(Structures::explain)
        .flatMap(bound -> toggle(owner, use, bound, target));
  }

  private Result<StructurePlan, Component> toggle(
      UUID owner, Use use, StructureBinder.Bound bound, Target target) {
    var grid = use.grid();
    var keeper = sign(grid, bound.keeper());
    var planned =
        StructureToggle.plan(bound.structure(), grid, kit.signs().stock(keeper), target)
            .mapError(Structures::explain);
    if (!(planned instanceof Result.Ok<StructurePlan, Component>(var plan))
        || plan.changes().isEmpty()) {
      return planned;
    }
    if (kit.guard().cells(owner, grid, bound.structure().cells())
        instanceof Decision.Denied(var reason)) {
      return Result.err(reason);
    }
    if (!cooldowns.tryStart(new Key(grid.world().getUID(), bound.keeper()), time.instant())) {
      return Result.err(Component.text("It is still moving; try again in a moment."));
    }
    // The stock is stored before any block moves, so even an unexpected pop cannot duplicate it.
    kit.signs().setStock(keeper, plan.stock());
    update(keeper);
    Placer.apply(grid, bound.structure(), plan.changes());
    return Result.ok(plan);
  }

  private Result<String, Component> deposit(PaperGrid grid, Pos keeperPos, ItemStack held) {
    var keeper = sign(grid, keeperPos);
    var material = PaperGrid.key(held.getType());
    var offered = Stock.of(material, held.getAmount());
    return StructureToggle.deposit(material, kit.signs().stock(keeper), offered)
        .mapError(Structures::explain)
        .map(
            stock -> {
              kit.signs().setStock(keeper, stock);
              update(keeper);
              held.setAmount(0);
              return "Added " + offered.count() + holding(stock);
            });
  }

  private static Component explain(StructureProblem problem) {
    return Component.text(problem.message());
  }

  private static String describe(StructurePlan plan) {
    return (plan.opened() ? "Opened" : "Closed") + holding(plan.stock());
  }

  private static String holding(Stock stock) {
    return stock.isEmpty()
        ? "."
        : "; it holds " + Names.count(stock.count(), stock.material().orElseThrow()) + ".";
  }

  private static Sign sign(PaperGrid grid, Pos pos) {
    if (grid.block(pos).getState() instanceof Sign sign) {
      return sign;
    }
    throw new IllegalStateException("a structure sign vanished at " + pos);
  }

  private static void update(Sign sign) {
    if (!sign.update()) {
      throw new IllegalStateException("could not store data on the sign at " + sign.getLocation());
    }
  }
}
