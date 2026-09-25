package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.Names;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Box;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import com.shepherdjerred.thestorm.mechanics.domain.structure.GateFinder;
import com.shepherdjerred.thestorm.mechanics.domain.structure.SpanFinder;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Structure;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructurePlan;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructureProblem;
import com.shepherdjerred.thestorm.mechanics.domain.structure.StructureToggle;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Target;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.block.Sign;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * Bridges, doors and gates. A structure's signs pool the blocks they hold on every toggle: the sign
 * used ends up holding everything and the others hold nothing, so the structure can be worked from
 * either end without blocks going missing or appearing.
 */
final class Structures {

  private final Kit kit;

  Structures(Kit kit) {
    this.kit = kit;
  }

  /**
   * A structure sign being used.
   *
   * @param grid its world
   * @param sign where it is
   * @param view what it reads
   */
  record Use(PaperGrid grid, Pos sign, SignView view) {

    Mechanism mechanism() {
      return view.mechanism().orElseThrow();
    }
  }

  /** The structure's blocks and every sign that pools its stock (the used sign first). */
  private record Found(Structure structure, List<Pos> signs) {}

  /** A plan with the signs it was pooled from, ready to apply. */
  private record Pending(Found found, List<Sign> signs, StructurePlan plan) {}

  /** A right-click: add the held blocks if they are the structure's, otherwise toggle it. */
  void click(Player player, Use use, UUID owner) {
    var feature = use.mechanism().feature();
    var held = player.getInventory().getItemInMainHand();
    var outcome =
        find(use)
            .mapError(Structures::explain)
            .flatMap(
                found ->
                    holds(held, found.structure())
                        ? deposit(use, found.structure(), held)
                        : toggle(owner, use, found, Target.TOGGLE).map(Structures::describe));
    switch (outcome) {
      case Result.Ok<String, Component>(var message) -> Replies.info(player, feature, message);
      case Result.Err<String, Component>(var reason) -> Replies.error(player, feature, reason);
    }
  }

  /**
   * Moves the structure a sign controls toward {@code target}, acting with {@code owner}'s land
   * rights: every block removed must be theirs to break and every block placed theirs to build.
   */
  Result<StructurePlan, Component> toggle(UUID owner, Use use, Target target) {
    return find(use)
        .mapError(Structures::explain)
        .flatMap(found -> toggle(owner, use, found, target));
  }

  private static boolean holds(ItemStack held, Structure structure) {
    return !held.isEmpty() && PaperGrid.key(held.getType()).equals(structure.material());
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

  private Result<String, Component> deposit(Use use, Structure structure, ItemStack held) {
    var sign = sign(use.grid(), use.sign());
    var offered = Stock.of(structure.material(), held.getAmount());
    return StructureToggle.deposit(structure.material(), kit.signs().stock(sign), offered)
        .mapError(Structures::explain)
        .map(
            stock -> {
              held.setAmount(0);
              kit.signs().setStock(sign, stock);
              sign.update();
              return "Added " + offered.count() + holding(stock);
            });
  }

  private Result<StructurePlan, Component> toggle(UUID owner, Use use, Found found, Target target) {
    var grid = use.grid();
    var signs = found.signs().stream().map(pos -> sign(grid, pos)).toList();
    Result<Stock, StructureProblem> pooled = Result.ok(Stock.empty());
    for (var sign : signs) {
      var stock = kit.signs().stock(sign);
      pooled = pooled.flatMap(total -> total.merge(stock));
    }
    return pooled
        .flatMap(stock -> StructureToggle.plan(found.structure(), grid, stock, target))
        .mapError(Structures::explain)
        .flatMap(plan -> apply(owner, grid, new Pending(found, signs, plan)));
  }

  private Result<StructurePlan, Component> apply(UUID owner, PaperGrid grid, Pending pending) {
    var plan = pending.plan();
    if (kit.guard().changes(owner, grid, plan.changes()) instanceof Decision.Denied(var reason)) {
      return Result.err(reason);
    }
    Placer.apply(grid, pending.found().structure(), plan.changes());
    var signs = pending.signs();
    for (var index = 0; index < signs.size(); index++) {
      var sign = signs.get(index);
      kit.signs().setStock(sign, index == 0 ? plan.stock() : Stock.empty());
      sign.update();
    }
    return Result.ok(plan);
  }

  private Result<Found, StructureProblem> find(Use use) {
    var config = kit.config();
    var grid = use.grid();
    return switch (use.mechanism().feature()) {
      case BRIDGE ->
          SpanFinder.bridge(grid, use.sign(), use.view(), config.bridge())
              .map(span -> new Found(span.structure(), List.of(use.sign(), span.farSign())));
      case DOOR ->
          SpanFinder.door(grid, use.sign(), use.view(), config.door())
              .map(span -> new Found(span.structure(), List.of(use.sign(), span.farSign())));
      case GATE ->
          GateFinder.find(grid, use.sign(), config.gate())
              .map(gate -> new Found(gate, gateSigns(use)));
      case HIDDEN_SWITCH,
          LIGHT_SWITCH,
          COOKING_POT,
          BLOCK_DROPS,
          ELEVATOR,
          SIGN_COPIER,
          PAINTING_SWITCHER,
          CRUSH,
          BOUNCE,
          SUPER_STICKY,
          SUPER_PUSH ->
          throw new IllegalArgumentException("not a structure: " + use.mechanism());
    };
  }

  /** The used gate sign, then every other gate sign within the gate search radius. */
  private List<Pos> gateSigns(Use use) {
    var signs = new ArrayList<Pos>();
    signs.add(use.sign());
    for (var pos : Box.around(use.sign(), kit.config().gate().searchRadius())) {
      if (!pos.equals(use.sign()) && isGateSign(use.grid(), pos)) {
        signs.add(pos);
      }
    }
    return signs;
  }

  private static boolean isGateSign(PaperGrid grid, Pos pos) {
    return grid.signAt(pos)
        .flatMap(SignView::mechanism)
        .filter(mechanism -> mechanism.feature() == Feature.GATE)
        .isPresent();
  }

  private static Sign sign(PaperGrid grid, Pos pos) {
    if (grid.block(pos).getState() instanceof Sign sign) {
      return sign;
    }
    throw new IllegalStateException("a structure sign vanished at " + pos);
  }
}
