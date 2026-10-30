package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.shop.KitPrefs;
import com.shepherdjerred.thestorm.rwf.app.shop.KitShop;
import com.shepherdjerred.thestorm.rwf.app.shop.Purchase;
import com.shepherdjerred.thestorm.rwf.app.shop.ShopError;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitPool;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitRotation;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.jspecify.annotations.Nullable;

/**
 * What kits each player may pick: the kits they own and whether the full kit list is on for them,
 * loaded off the main thread when they join or open the kit menu and kept until they quit, plus
 * this week's free rotation. Purchases go through the {@link KitShop} and update the loaded owned
 * kits once the ledger has them. Main thread only.
 */
final class Armory {

  /**
   * What is known of one player.
   *
   * @param expanded whether the full kit list is on for them
   * @param owned the kits they own
   * @param prefs their last kit and saved layouts
   */
  private record Loaded(boolean expanded, Set<String> owned, KitPrefs prefs) {}

  /** The flag answer and owned kits, before the prefs join them. */
  private record Access(boolean expanded, Set<String> owned) {}

  record Parts(
      PaperContext context,
      KitShop shop,
      JoinGate gate,
      List<KitSpec> kits,
      java.util.function.Supplier<KitPool> pool) {}

  private final PaperContext context;
  private final KitShop shop;
  private final JoinGate gate;
  private final List<KitSpec> kits;
  private final java.util.function.Supplier<KitPool> pool;
  private final Map<UUID, Loaded> loaded = new HashMap<>();
  private final Map<UUID, List<Runnable>> waiting = new HashMap<>();
  private final Set<UUID> buying = new HashSet<>();
  private KitRotation.@Nullable Week week;
  private @Nullable KitPool rotationPool;
  private List<KitSpec> rotation = List.of();

  Armory(Parts parts) {
    this.context = parts.context();
    this.shop = parts.shop();
    this.gate = parts.gate();
    this.kits = List.copyOf(parts.kits());
    this.pool = parts.pool();
  }

  List<KitSpec> kits() {
    var admitted = pool.get();
    return kits.stream().filter(kit -> admitted.allows(kit.id())).toList();
  }

  List<KitSpec> milestones() {
    var admitted = kits();
    return com.shepherdjerred.thestorm.rwf.domain.kit.KitBook.MILESTONE_ONE.stream()
        .filter(admitted::contains)
        .toList();
  }

  /** The kits free this week, in menu order. */
  List<KitSpec> rotation(Instant now) {
    var current = KitRotation.Week.of(now);
    var admitted = pool.get();
    if (!current.equals(week) || !admitted.equals(rotationPool)) {
      var candidates = kits();
      rotation = KitRotation.ofOptional(current, candidates).orElseGet(List::of);
      week = current;
      rotationPool = admitted;
    }
    return rotation;
  }

  /** When this week's rotation ends. */
  Instant rotationEnds(Instant now) {
    return KitRotation.Week.of(now).endsAt();
  }

  /** What {@code player} may pick now, once their kits have loaded. */
  Optional<KitAccess> access(UUID player) {
    var known = loaded.get(player);
    if (known == null) {
      return Optional.empty();
    }
    if (!known.expanded()) {
      return Optional.of(KitAccess.MILESTONE_ONE);
    }
    var free = new HashSet<String>();
    rotation(context.time().instant()).forEach(kit -> free.add(kit.id()));
    return Optional.of(KitAccess.of(known.owned(), free));
  }

  /** Whether the full kit list and the shop are on for {@code player}. */
  boolean expanded(UUID player) {
    var known = loaded.get(player);
    return known != null && known.expanded();
  }

  /** Whether anyone whose kits are loaded can see the lobby's expanded rotation display. */
  boolean anyExpanded() {
    return loaded.values().stream().anyMatch(Loaded::expanded);
  }

  /**
   * Loads {@code player}'s kits, then runs {@code then} on the main thread; at once when they are
   * loaded already.
   */
  void load(UUID player, Runnable then) {
    if (loaded.containsKey(player)) {
      then.run();
      return;
    }
    var queue = waiting.get(player);
    if (queue != null) {
      queue.add(then);
      return;
    }
    queue = new ArrayList<>();
    queue.add(then);
    waiting.put(player, queue);
    var expanded =
        gate.allows(player)
            .exceptionally(
                failure -> {
                  context
                      .logger()
                      .warn(
                          "Could not evaluate the rwf kits flag for {}; offering the first"
                              + " four kits",
                          player,
                          failure);
                  return false;
                });
    var owned = shop.owned(player);
    // Stored prefs that cannot be read are a broken contract: the load fails rather than starting
    // from empty prefs that the next saved layout would write over the player's real ones.
    var prefs = shop.prefs(player);
    context.onMain(
        expanded
            .thenCombine(owned, Access::new)
            .thenCombine(
                prefs, (access, kept) -> new Loaded(access.expanded(), access.owned(), kept)),
        known -> {
          loaded.put(player, known);
          var run = waiting.remove(player);
          if (run != null) {
            run.forEach(Runnable::run);
          }
        },
        () -> {
          // Nothing waits on a failed read: the next menu or purchase starts a fresh one.
          waiting.remove(player);
          var online = context.server().getPlayer(player);
          if (online != null) {
            Texts.error(online, "Your kits could not be loaded; try again in a moment.");
          }
        },
        "load the rwf kits of " + player);
  }

  /** {@code player}'s saved layout for {@code kit}, once loaded. */
  Optional<KitLayout> layout(UUID player, String kit) {
    return Optional.ofNullable(loaded.get(player)).flatMap(known -> known.prefs().layout(kit));
  }

  /** The kit {@code player} last played, once loaded. */
  Optional<String> lastKit(UUID player) {
    return Optional.ofNullable(loaded.get(player)).flatMap(known -> known.prefs().lastKit());
  }

  /** Publishes {@code layout} and reports success only after its durable write succeeds. */
  void saveLayout(UUID player, String kit, KitLayout layout, Consumer<Boolean> done) {
    context.onMain(
        shop.saveLayout(player, kit, layout),
        ignored -> {
          var known = loaded.get(player);
          if (known != null) {
            var layouts = new HashMap<>(known.prefs().layouts());
            layouts.put(kit, layout);
            loaded.put(
                player,
                new Loaded(
                    known.expanded(),
                    known.owned(),
                    new KitPrefs(known.prefs().lastKit(), layouts)));
          }
          done.accept(true);
        },
        () -> done.accept(false),
        "save an rwf kit layout");
  }

  /** Forgets {@code player}, who quit. */
  void forget(UUID player) {
    loaded.remove(player);
    waiting.remove(player);
  }

  /**
   * {@code player} buys {@code kit}; {@code done} hears the result on the main thread. One purchase
   * at a time per player.
   */
  void buy(UUID player, KitSpec kit, Consumer<Result<Purchase, ShopError>> done) {
    var admitted = pool.get();
    if (!buying.add(player)) {
      done.accept(Result.err(new ShopError.InProgress(kit.id())));
      return;
    }
    var future = shop.buy(player, admitted, kit, context.time().instant());
    var _ =
        future.whenCompleteAsync(
            (result, failure) -> {
              buying.remove(player);
              if (failure != null) {
                context.logger().error("Could not buy kit {} for {}", kit.id(), player, failure);
                done.accept(Result.err(new ShopError.InProgress(kit.id())));
                return;
              }
              if (result instanceof Result.Ok<Purchase, ShopError>
                  || result instanceof Result.Err<Purchase, ShopError>(ShopError.AlreadyOwned _)) {
                owned(player, kit.id());
              }
              context.guarded("finish a kit purchase", () -> done.accept(result));
            },
            context.mainThread());
  }

  private void owned(UUID player, String kit) {
    var known = loaded.get(player);
    if (known != null) {
      var owned = new HashSet<>(known.owned());
      owned.add(kit);
      loaded.put(player, new Loaded(known.expanded(), owned, known.prefs()));
    }
  }

  /** {@code player}'s Red Warfare credits, on the main thread. */
  void credits(UUID player, Consumer<Long> then) {
    context.onMain(shop.balance(player), money -> then.accept(money.amount()), "read rwf credits");
  }
}
