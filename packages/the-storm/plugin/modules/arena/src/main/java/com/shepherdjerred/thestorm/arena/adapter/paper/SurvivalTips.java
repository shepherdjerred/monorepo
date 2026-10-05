package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.SurvivalProgress;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalTutorials;
import com.shepherdjerred.thestorm.arena.domain.survival.TutorialGraph;
import com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey;
import com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey.Topic;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** One first-encounter lesson at a time; gameplay warnings interrupt without marking it seen. */
final class SurvivalTips {
  private static final class State {
    final Set<TutorialKey> seen;
    final Set<TutorialKey> contexts = new HashSet<>();
    boolean enabled;
    TutorialGraph.@Nullable Tip active;
    Instant finishes = Instant.MIN;
    Instant next = Instant.MIN;

    State(SurvivalProgress.Tips saved) {
      seen = new HashSet<>(saved.seen());
      enabled = saved.enabled();
    }
  }

  private final SurvivalRunner runner;
  private final SurvivalProgress progress;
  private final TutorialGraph graph = SurvivalTutorials.catalog();
  private final Map<UUID, State> states = new HashMap<>();
  private Instant nextScan = Instant.MIN;

  SurvivalTips(SurvivalRunner runner, SurvivalProgress progress) {
    this.runner = runner;
    this.progress = progress;
  }

  void loaded(UUID player, SurvivalProgress.Tips saved) {
    var state = new State(saved);
    state.contexts.add(TutorialKey.of(Topic.ENTRY));
    state.contexts.add(TutorialKey.of(Topic.CLASSES));
    states.put(player, state);
  }

  void encounter(Player player, TutorialKey key) {
    var state = states.get(player.getUniqueId());
    if (state != null && !state.seen.contains(key)) state.contexts.add(key);
  }

  boolean seen(Player player, TutorialKey key) {
    var state = states.get(player.getUniqueId());
    return state != null && state.seen.contains(key);
  }

  void tick() {
    var now = runner.context().time().instant();
    if (!now.isBefore(nextScan)) {
      nextScan = now.plusMillis(250);
      runner.online().forEach(this::contexts);
    }
    for (var player : runner.online()) tick(player, now);
  }

  private void tick(Player player, Instant now) {
    var state = states.get(player.getUniqueId());
    if (state == null) return;
    var active = state.active;
    var blocked =
        !state.enabled
            || runner.downed(player.getUniqueId())
            || runner.combat().boss().flatMap(SurvivalBoss::cast).isPresent();
    if (active != null) {
      if (blocked || !runner.hud().message(player).equals(caption(active))) {
        state.active = null;
        state.next = now.plusSeconds(12);
        return;
      }
      if (!now.isBefore(state.finishes)) {
        state.seen.add(active.key());
        state.contexts.remove(active.key());
        state.active = null;
        state.next = now.plusSeconds(12);
        if (!runner.game().debug())
          runner
              .context()
              .logFailure(
                  progress.tip(player.getUniqueId(), active.key()), "remember survival tutorial");
      } else player.sendActionBar(net.kyori.adventure.text.Component.text(caption(active)));
      return;
    }
    if (blocked || now.isBefore(state.next) || runner.hud().busy(player)) return;
    graph
        .next(state.contexts, state.seen)
        .ifPresent(
            tip -> {
              state.active = tip;
              state.finishes = now.plusSeconds(6);
              runner.hud().hint(player, caption(tip), 6);
              Texts.info(player, "Tip · " + tip.text());
            });
  }

  private void contexts(Player player) {
    if (!runner.running()) return;
    encounter(player, TutorialKey.of(Topic.COMBAT));
    if (runner.talents().build(player.getUniqueId()).pending() > 0)
      encounter(player, TutorialKey.of(Topic.SPECIALIZATIONS));
    if (runner.online().stream()
        .anyMatch(
            other ->
                runner.downed(other.getUniqueId())
                    && Places.at(other).distanceSquared(Places.at(player)) <= 64))
      encounter(player, TutorialKey.of(Topic.REVIVAL));
    runner.map().open().forEach(zone -> zoneContexts(player, zone));
    fixtureContexts(player);
    combatContexts(player);
    equipmentContexts(player);
  }

  private static String caption(TutorialGraph.Tip tip) {
    var key = tip.key();
    var title = key.variant().isEmpty() ? key.topic().name() : key.variant();
    return "Tip · "
        + title.toLowerCase(java.util.Locale.ROOT).replace('_', ' ').replace('-', ' ')
        + " · details in chat · /survival guide";
  }

  private void zoneContexts(Player player, SurvivalContent.Zone zone) {
    zone.resources().stream()
        .filter(resource -> near(player, resource.block()))
        .forEach(
            resource -> {
              encounter(player, TutorialKey.of(Topic.GATHERING));
              if (player.isSneaking()) encounter(player, TutorialKey.of(Topic.NODE_UPGRADES));
            });
    zone.stations().stream()
        .filter(station -> near(player, station.block()))
        .forEach(
            station -> {
              encounter(
                  player,
                  TutorialKey.of(
                      station.type() == SurvivalContent.StationType.BANK
                          ? Topic.BANKING
                          : Topic.CRAFTING));
              if (station.type() == SurvivalContent.StationType.ALCHEMY
                  || station.type() == SurvivalContent.StationType.FORGE)
                encounter(player, TutorialKey.of(Topic.ENCHANTING));
            });
    zone.defenses().stream()
        .filter(defense -> near(player, defense.block()))
        .forEach(defense -> encounter(player, TutorialKey.of(Topic.DEFENSES)));
  }

  private void fixtureContexts(Player player) {
    for (var zone : runner.map().content().zones())
      for (var sign : zone.purchaseSigns())
        if (near(player, sign)) encounter(player, TutorialKey.of(Topic.ROUTES));
    for (var machine : runner.map().content().machines())
      if (near(player, machine.block())) machine(player, machine.type());
    for (var site : runner.map().content().boxSites())
      if (site.id().equals(runner.machines().box().active()) && near(player, site.block()))
        encounter(player, TutorialKey.of(Topic.BOX));
    if (near(player, runner.map().content().planeWorkbench()))
      encounter(player, TutorialKey.of(Topic.PLANE));
  }

  private void combatContexts(Player player) {
    runner
        .combat()
        .encounter()
        .ifPresent(event -> encounter(player, new TutorialKey(Topic.ENCOUNTER, event.name())));
    runner
        .combat()
        .boss()
        .ifPresent(
            boss -> {
              encounter(player, new TutorialKey(Topic.BOSS, boss.id()));
              boss.cast()
                  .ifPresent(
                      cast -> encounter(player, new TutorialKey(Topic.CAST, cast.shape().name())));
            });
  }

  private void equipmentContexts(Player player) {
    for (var item : java.util.Objects.requireNonNull(player.getInventory().getContents()))
      if (item != null && runner.items().equipment(item)) {
        if (runner.items().rarity(item)
            != com.shepherdjerred.thestorm.arena.domain.survival.GearRarity.COMMON)
          encounter(player, TutorialKey.of(Topic.RARITY));
        runner
            .items()
            .legendary(item)
            .ifPresent(
                effect -> encounter(player, new TutorialKey(Topic.EQUIPMENT, effect.name())));
      }
  }

  private void machine(Player player, SurvivalContent.MachineType type) {
    switch (type) {
      case POWER -> encounter(player, TutorialKey.of(Topic.POWER));
      case RUNEFORGE -> encounter(player, TutorialKey.of(Topic.AUGMENTATION));
      case MYSTERY_BOX -> encounter(player, TutorialKey.of(Topic.BOX));
      case STONEWARD, GALESTRIDE, EMBERWEAVE, SOULBOND ->
          encounter(player, new TutorialKey(Topic.BOON, type.name()));
      case FOOD -> encounter(player, TutorialKey.of(Topic.CRAFTING));
    }
  }

  private static boolean near(
      Player player, com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos at) {
    return Places.at(player).distanceSquared(Places.location(player.getWorld(), at.center())) <= 64;
  }

  void setting(Player player, String setting) {
    var state = states.get(player.getUniqueId());
    if (state == null) return;
    switch (setting) {
      case "on", "off" -> {
        state.enabled = setting.equals("on");
        if (!runner.game().debug())
          runner
              .context()
              .logFailure(
                  progress.tipsEnabled(player.getUniqueId(), state.enabled),
                  "save tutorial preference");
      }
      case "reset" -> {
        state.seen.clear();
        state.contexts.add(TutorialKey.of(Topic.ENTRY));
        state.contexts.add(TutorialKey.of(Topic.CLASSES));
        if (!runner.game().debug())
          runner
              .context()
              .logFailure(progress.resetTips(player.getUniqueId()), "reset survival tutorials");
      }
      default -> throw new IllegalArgumentException("Invalid tutorial setting");
    }
    state.active = null;
    state.next = Instant.MIN;
    Texts.info(
        player, "Survival tips: " + setting + ". /survival guide keeps every topic available.");
  }

  void leave(UUID player) {
    states.remove(player);
  }
}
