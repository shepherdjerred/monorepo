package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.engine.Facts;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;

/** In-memory stand-ins for the store, the world and rewards. */
final class Fakes {

  private Fakes() {}

  static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  /** A clock the test moves. */
  static final class Clock implements InstantSource {
    Instant now;

    Clock(Instant now) {
      this.now = now;
    }

    @Override
    public Instant instant() {
      return now;
    }
  }

  /** Keeps state in a map; futures complete immediately. */
  static final class Store implements QuestStore {
    final Map<UUID, PlayerQuests> saved = new HashMap<>();
    final Map<UUID, List<PendingWorld>> pending = new HashMap<>();
    Optional<CompletableFuture<PlayerQuests>> deferredLoad = Optional.empty();
    Optional<CompletableFuture<Void>> deferredSave = Optional.empty();
    int loads;
    int saves;

    @Override
    public CompletableFuture<PlayerQuests> load(UUID player) {
      loads++;
      if (deferredLoad.isPresent()) {
        return deferredLoad.orElseThrow();
      }
      return CompletableFuture.completedFuture(
          saved.getOrDefault(player, PlayerQuests.empty(player)));
    }

    @Override
    public CompletableFuture<Void> save(PlayerQuests state, List<PendingWorld> effects) {
      saves++;
      return deferredSave
          .orElseGet(() -> CompletableFuture.completedFuture(null))
          .thenRun(
              () -> {
                saved.put(state.player(), state);
                pending
                    .computeIfAbsent(state.player(), ignored -> new ArrayList<>())
                    .addAll(effects);
              });
    }

    @Override
    public CompletableFuture<List<PendingWorld>> pending(UUID player) {
      return CompletableFuture.completedFuture(
          List.copyOf(pending.getOrDefault(player, List.of())));
    }

    @Override
    public CompletableFuture<Boolean> claim(UUID effect) {
      for (var effects : pending.values()) {
        for (var index = 0; index < effects.size(); index++) {
          var found = effects.get(index);
          if (found.id().equals(effect) && found.status() == Status.PENDING) {
            effects.set(
                index,
                new PendingWorld(
                    found.id(), found.player(), found.quest(), found.action(), Status.IN_DOUBT));
            return CompletableFuture.completedFuture(true);
          }
        }
      }
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> retry(UUID player, UUID effect) {
      var effects = pending.getOrDefault(player, List.of());
      for (var index = 0; index < effects.size(); index++) {
        var found = effects.get(index);
        if (found.id().equals(effect) && found.status() == Status.IN_DOUBT) {
          effects.set(
              index,
              new PendingWorld(
                  found.id(), found.player(), found.quest(), found.action(), Status.PENDING));
          return CompletableFuture.completedFuture(true);
        }
      }
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> complete(UUID player, UUID effect) {
      var effects = pending.get(player);
      return CompletableFuture.completedFuture(
          effects != null
              && effects.removeIf(
                  found -> found.id().equals(effect) && found.status() == Status.IN_DOUBT));
    }

    @Override
    public CompletableFuture<Void> acknowledge(UUID effect) {
      var removed =
          pending.values().stream()
              .anyMatch(
                  effects ->
                      effects.removeIf(
                          found -> found.id().equals(effect) && found.status() == Status.IN_DOUBT));
      return removed
          ? CompletableFuture.completedFuture(null)
          : CompletableFuture.failedFuture(
              new IllegalStateException("claimed quest action disappeared: " + effect));
    }

    @Override
    public CompletableFuture<List<Standing>> top(int limit) {
      return CompletableFuture.completedFuture(
          saved.values().stream()
              .filter(state -> state.points() > 0)
              .filter(
                  state ->
                      pending.getOrDefault(state.player(), List.of()).stream()
                          .noneMatch(effect -> effect.action() instanceof Action.Take))
              .sorted((a, b) -> Long.compare(b.points(), a.points()))
              .limit(limit)
              .map(state -> new Standing(state.player(), state.points()))
              .toList());
    }
  }

  /** Online players are those with scripted facts; everything done to them is recorded. */
  static final class World implements QuestWorld {
    final Map<UUID, ScriptedFacts> online = new HashMap<>();
    final Map<UUID, List<String>> messages = new HashMap<>();
    final Map<UUID, List<String>> actionBars = new HashMap<>();
    final Map<UUID, Map<String, NpcMark>> markers = new HashMap<>();
    final Map<UUID, Optional<Journal.Sidebar>> sidebars = new HashMap<>();
    final List<String> actions = new ArrayList<>();

    ScriptedFacts join(UUID player) {
      var facts = new ScriptedFacts();
      online.put(player, facts);
      return facts;
    }

    ScriptedFacts carry(UUID player) {
      return Objects.requireNonNull(online.get(player));
    }

    List<String> said(UUID player) {
      return messages.getOrDefault(player, List.of());
    }

    @Override
    public Optional<Facts> facts(UUID player) {
      return Optional.ofNullable(online.get(player));
    }

    @Override
    public Optional<Player> player(UUID player) {
      return Optional.empty();
    }

    @Override
    public void give(UUID player, ItemMatch item, int amount) {
      actions.add("give " + amount + " " + item.material());
      Objects.requireNonNull(online.get(player)).give(item, amount);
    }

    @Override
    public boolean take(UUID player, ItemMatch item, int amount) {
      if (facts(player).isEmpty() || carry(player).count(item) < amount) {
        return false;
      }
      actions.add("take " + amount + " " + item.material());
      Objects.requireNonNull(online.get(player)).take(item, amount);
      return true;
    }

    @Override
    public CompletableFuture<Boolean> teleport(UUID player, Region region) {
      actions.add("teleport " + region.id());
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public void spawn(UUID player, Action.Spawn spawn, Region region) {
      actions.add("spawn " + spawn.count() + " " + spawn.entity() + " " + region.id());
    }

    @Override
    public void send(UUID player, Component message) {
      messages.computeIfAbsent(player, ignored -> new ArrayList<>()).add(plain(message));
    }

    @Override
    public void actionBar(UUID player, Component message) {
      actionBars.computeIfAbsent(player, ignored -> new ArrayList<>()).add(plain(message));
    }

    @Override
    public void markers(UUID player, Map<String, NpcMark> marks) {
      markers.put(player, Map.copyOf(marks));
    }

    @Override
    public void sidebar(UUID player, Optional<Journal.Sidebar> sidebar) {
      sidebars.put(player, sidebar);
    }
  }

  /** Pays and grants into lists; can be told to refuse payments. */
  static final class Rewards implements com.shepherdjerred.thestorm.quests.app.Rewards {
    final List<String> paid = new ArrayList<>();
    final Map<UUID, String> paidByEffect = new HashMap<>();
    final List<String> granted = new ArrayList<>();
    boolean refuse;

    @Override
    public CompletableFuture<Result<String, String>> pay(
        UUID effect, UUID player, long crystals, String reason) {
      if (refuse) {
        return CompletableFuture.completedFuture(Result.err("bank closed"));
      }
      if (paidByEffect.putIfAbsent(effect, crystals + " " + reason) == null) {
        paid.add(crystals + " " + reason);
      }
      return CompletableFuture.completedFuture(Result.ok(crystals + " crystals"));
    }

    @Override
    public CompletableFuture<Void> grant(UUID player, String permission) {
      granted.add(permission);
      return CompletableFuture.completedFuture(null);
    }
  }
}
