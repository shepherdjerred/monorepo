package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.app.store.SurvivalProgress;
import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import com.shepherdjerred.thestorm.arena.domain.survival.PassiveRecovery;
import com.shepherdjerred.thestorm.arena.domain.survival.Revival;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalGame;
import com.shepherdjerred.thestorm.arena.domain.survival.Survivor;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.jspecify.annotations.Nullable;

/** Survival lifecycle with the same crash-safe snapshots and protections as the Colosseum. */
final class SurvivalRunner implements ArenaRunner {
  record Services(
      PaperContext context,
      Snapshots snapshots,
      Keys keys,
      WaveTable waves,
      SurvivalProgress progress,
      LeaderboardStore leaderboard,
      com.shepherdjerred.thestorm.arena.app.SurvivalGate gate) {}

  private final ArenaWorld world;
  private final Services services;
  private final SurvivalGame game = new SurvivalGame();
  private final SettlementMap map;
  private final Set<com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos> volatilePositions;
  private final Revival revival = new Revival();
  private final PassiveRecovery recovery = new PassiveRecovery();
  private final Map<UUID, Long> xp = new HashMap<>();
  private final Set<UUID> spectators = new HashSet<>();
  private final Set<UUID> respawning = new HashSet<>();
  private UUID run;
  private SurvivalItems items;
  private SurvivalCombat combat;
  private SurvivalActions actions;
  private ZombiesMachines machines;
  private ZombiesDrops drops;
  private final SurvivalHud hud;
  private final SurvivalMenus menus;
  private final SurvivalFeedback feedback;
  private final SurvivalTalents talents;
  private final SurvivalClassMenus classMenus;
  private final SurvivalPresentation presentation;
  private final LegendaryCombat legendary;
  private final SurvivalGuide guide;
  private final SurvivalAnnouncements announcements;
  private boolean prepared;
  private boolean stopping;
  private @Nullable Cancellable startupTask;
  private final java.util.concurrent.CompletableFuture<Void> startup =
      new java.util.concurrent.CompletableFuture<>();

  SurvivalRunner(ArenaWorld world, SurvivalContent content, Services services) {
    this.world = world;
    this.services = services;
    SurvivalItems.validate(content);
    map = new SettlementMap(world, content);
    volatilePositions = volatileBlocks();
    run = runId();
    feedback = new SurvivalFeedback(this);
    talents = new SurvivalTalents(this);
    classMenus = new SurvivalClassMenus(this);
    presentation = new SurvivalPresentation(this);
    legendary = new LegendaryCombat(this);
    guide = new SurvivalGuide(this);
    announcements = new SurvivalAnnouncements(this);
    items = new SurvivalItems(services.keys(), run, feedback, content);
    combat = newCombat();
    actions = new SurvivalActions(this);
    machines = new ZombiesMachines(this);
    drops = new ZombiesDrops(this);
    hud = new SurvivalHud(this);
    menus = new SurvivalMenus(this);
  }

  private UUID runId() {
    return new UUID(services.context().random().nextLong(), services.context().random().nextLong());
  }

  private SurvivalCombat newCombat() {
    return new SurvivalCombat(
        world,
        map,
        new SurvivalCombat.Services(
            services.context(), services.waves(), services.progress(), run, items, this::credit));
  }

  PaperContext context() {
    return services.context();
  }

  SurvivalGame game() {
    return game;
  }

  SettlementMap map() {
    return map;
  }

  SurvivalItems items() {
    return items;
  }

  SurvivalCombat combat() {
    return combat;
  }

  SurvivalMenus menus() {
    return menus;
  }

  SurvivalActions actions() {
    return actions;
  }

  ZombiesMachines machines() {
    return machines;
  }

  ZombiesDrops drops() {
    return drops;
  }

  SurvivalHud hud() {
    return hud;
  }

  SurvivalFeedback feedback() {
    return feedback;
  }

  SurvivalTalents talents() {
    return talents;
  }

  SurvivalClassMenus classMenus() {
    return classMenus;
  }

  LegendaryCombat legendary() {
    return legendary;
  }

  SurvivalGuide guide() {
    return guide;
  }

  void tag(org.bukkit.entity.Entity entity) {
    services.keys().tag(entity, id());
  }

  long xp(UUID id) {
    return xp.getOrDefault(id, 0L);
  }

  void probeProgress(UUID id) {
    if (!game.debug() || running())
      throw new IllegalStateException("Probe progression requires a debug lobby");
    xp.put(id, 3000L);
  }

  @Override
  public String id() {
    return world.definition().id();
  }

  @Override
  public ArenaWorld world() {
    return world;
  }

  @Override
  public boolean running() {
    return game.running();
  }

  @Override
  public Collection<Member> members() {
    return game.players().stream().map(this::view).toList();
  }

  @Override
  public Optional<Member> member(UUID id) {
    return game.player(id).map(this::view);
  }

  @Override
  public boolean isFighter(UUID id) {
    return game.player(id).filter(p -> p.status() == Survivor.Status.STANDING).isPresent();
  }

  private Member view(Survivor player) {
    var kit = player.role().name().toLowerCase(Locale.ROOT);
    return switch (player.status()) {
      case JOINING ->
          new Member.Pending(
              player.id(),
              player.name(),
              spectators.contains(player.id()) ? Member.Role.SPECTATOR : Member.Role.PLAYER);
      case LOBBY ->
          new Member.InLobby(player.id(), player.name(), Optional.of(kit), player.ready());
      case STANDING, DOWNED -> new Member.Fighter(player.id(), player.name(), kit, game.round());
      case WAITING, SPECTATOR -> new Member.Watcher(player.id(), player.name());
    };
  }

  @Override
  public Optional<GameError> handle(GameEvent event) {
    return switch (event) {
      case GameEvent.Join join -> join(join.player(), join.name(), false);
      case GameEvent.Spectate join -> join(join.player(), join.name(), true);
      case GameEvent.SnapshotStored stored -> {
        admitted(stored.player());
        yield Optional.empty();
      }
      case GameEvent.SnapshotFailed failed -> {
        game.leave(failed.player());
        yield Optional.empty();
      }
      case GameEvent.PickClass pick -> select(pick.player(), pick.kit());
      case GameEvent.Ready ready -> {
        var failure = game.ready(ready.player(), context().time().instant());
        var player = context().server().getPlayer(ready.player());
        if (failure.isEmpty() && player != null) announcements.ready(player);
        yield failure;
      }
      case GameEvent.ForceStart start ->
          game.forceStart(start.now()) ? Optional.empty() : Optional.of(GameError.NOTHING_TO_START);
      case GameEvent.Leave leave -> {
        leave(leave.player());
        yield Optional.empty();
      }
      case GameEvent.Disconnect leave -> {
        leave(leave.player());
        yield Optional.empty();
      }
      case GameEvent.Died died -> {
        died(died.player());
        yield Optional.empty();
      }
      case GameEvent.Stop _ -> {
        stop();
        yield Optional.empty();
      }
      case GameEvent.Tick _ -> Optional.empty();
    };
  }

  private Optional<GameError> join(UUID id, String name, boolean spectator) {
    var refusal = game.join(id, name, spectator);
    if (refusal.isPresent()) {
      return refusal;
    }
    if (spectator) {
      spectators.add(id);
    }
    var player = context().server().getPlayer(id);
    if (player == null) {
      game.leave(id);
      return Optional.of(GameError.UNAVAILABLE);
    }
    var _ =
        services
            .gate()
            .enabled(id)
            .whenCompleteAsync(
                (enabled, failure) -> {
                  if (game.player(id).isEmpty()) {
                    return;
                  }
                  if (failure != null || !enabled) {
                    game.leave(id);
                    spectators.remove(id);
                    Texts.error(player, "Settlement survival is not available to you yet.");
                    if (failure != null) {
                      context().logger().error("Could not evaluate survival rollout", failure);
                    }
                    return;
                  }
                  capture(player, id);
                },
                context().mainThread());
    return Optional.empty();
  }

  private void capture(Player player, UUID id) {
    services
        .snapshots()
        .capture(
            player,
            id(),
            saved -> {
              if (!saved) {
                game.leave(id);
                spectators.remove(id);
                return;
              }
              if (game.player(id).isEmpty()) {
                services.snapshots().restore(player);
                return;
              }
              var _ =
                  services
                      .progress()
                      .xp(id)
                      .whenCompleteAsync(
                          (total, failure) -> {
                            if (failure != null) {
                              context()
                                  .logger()
                                  .error("Could not load survival XP for {}", id, failure);
                              leave(id);
                              return;
                            }
                            if (game.player(id)
                                .filter(p -> p.status() == Survivor.Status.JOINING)
                                .isEmpty()) {
                              return;
                            }
                            xp.put(id, total);
                            admitted(id);
                          },
                          context().mainThread());
            });
  }

  private void admitted(UUID id) {
    game.admitted(id, spectators.contains(id));
    var player = context().server().getPlayer(id);
    if (player == null) {
      leave(id);
      return;
    }
    if (spectators.contains(id)) {
      PlayerStates.wipe(player, GameMode.SPECTATOR);
      player.teleport(Places.location(world.world(), world.definition().spectator()));
    } else {
      items.equip(player, SurvivalClass.FIGHTER, false);
      player.teleport(Places.location(world.world(), world.definition().lobby()));
      if (game.debug())
        Texts.info(
            player,
            "DEBUG lobby · starts at round "
                + game.startRound()
                + ". Teammates may join normally; no persistent progression.");
      Texts.info(
          player,
          "Survival: Fighter selected. Use your compass to choose a class; click the iron block to ready up. The lobby book explains the rules.");
      announcements.joined(player);
    }
  }

  private Optional<GameError> select(UUID id, String name) {
    SurvivalClass role;
    try {
      role = SurvivalClass.valueOf(name.toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException error) {
      return Optional.of(GameError.UNKNOWN_CLASS);
    }
    var refusal = game.select(id, role, xp(id));
    if (refusal.isEmpty()) {
      var player = context().server().getPlayer(id);
      if (player != null) {
        items.equip(player, role, false);
        Texts.info(player, "Selected " + role + ".");
      }
    }
    return refusal;
  }

  List<Player> online() {
    return game.players().stream()
        .map(p -> context().server().getPlayer(p.id()))
        .filter(java.util.Objects::nonNull)
        .toList();
  }

  List<Player> fighters() {
    return online().stream().filter(p -> isFighter(p.getUniqueId())).toList();
  }

  @Override
  public void tick() {
    try {
      advance();
    } catch (RuntimeException failure) {
      context().logger().error("Survival encounter stopped; restoring all participants", failure);
      stop();
    }
  }

  private void advance() {
    keepMembers();
    if (world.preloadFailed()) {
      stop();
      return;
    }
    if (game.phase() == SurvivalGame.Phase.COUNTDOWN || running()) {
      world.preload();
    }
    if (!world.chunksReady()) {
      return;
    }
    prepareRun();
    var before = expirePlayers();
    if (game.wiped()) {
      stop();
      return;
    }
    if (game.advance(context().time().instant())) {
      beginRound(before);
    }
    if (running()) {
      outsiders();
      machines.tick();
      talents.tick();
      legendary.tick();
      drops.tick();
      revive();
      fighters().forEach(this::recover);
    }
    if (game.phase() == SurvivalGame.Phase.FIGHTING) {
      combat.tick(fighters(), online());
      if (combat.clear()) {
        cleared();
      }
    }
    hud.tick();
    presentation.tick();
  }

  @Override
  public java.util.concurrent.CompletableFuture<Void> prepareStartup() {
    world.cleanUp();
    var _ =
        java.util.concurrent.CompletableFuture.supplyAsync(
                () ->
                    new com.shepherdjerred.thestorm.arena.domain.survival.SettlementBlueprint(
                            map.content())
                        .blocks())
            .whenCompleteAsync(
                (blueprint, failure) -> {
                  if (startup.isDone()) {
                    return;
                  }
                  if (failure != null) {
                    startup.completeExceptionally(failure);
                    return;
                  }
                  validateStartup(blueprint);
                },
                context().mainThread());
    return startup;
  }

  private void validateStartup(
      Map<com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos, String> blueprint) {
    var entries = blueprint.entrySet().iterator();
    var palette = new HashMap<String, org.bukkit.block.data.BlockData>();
    startupTask =
        context()
            .scheduler()
            .repeatOnMainThread(
                java.time.Duration.ZERO,
                java.time.Duration.ofMillis(50),
                () -> {
                  try {
                    for (var i = 0; i < 2000 && entries.hasNext(); i++) {
                      var entry = entries.next();
                      if (!volatileBlock(entry.getKey())
                          && !world
                              .block(entry.getKey())
                              .getBlockData()
                              .matches(
                                  palette.computeIfAbsent(
                                      entry.getValue(), BlueprintBlock::parse))) {
                        throw new IllegalStateException(
                            "Settlement blueprint is missing or changed at " + entry.getKey());
                      }
                    }
                    if (!entries.hasNext()) {
                      cancelStartup();
                      map.reset();
                      machines.prepare();
                      guide.prepare();
                      startup.complete(null);
                    }
                  } catch (RuntimeException failure) {
                    cancelStartup();
                    startup.completeExceptionally(failure);
                  }
                });
  }

  private boolean volatileBlock(com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos pos) {
    return volatilePositions.contains(pos);
  }

  private Set<com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos> volatileBlocks() {
    var positions = new HashSet<com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos>();
    for (var zone : map.content().zones()) {
      positions.addAll(zone.gate());
      positions.addAll(zone.purchaseSigns());
      for (var defense : zone.defenses()) {
        var spread = defense.type() == SurvivalContent.DefenseType.BARRICADE ? 1 : 0;
        for (var dx = -spread; dx <= spread; dx++) {
          var block = defense.block();
          positions.add(
              new com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos(
                  block.x() + dx, block.y(), block.z()));
        }
      }
    }
    map.content().boxSites().forEach(site -> positions.add(site.beacon()));
    return Set.copyOf(positions);
  }

  private void cancelStartup() {
    if (startupTask != null) {
      startupTask.cancel();
      startupTask = null;
    }
  }

  private void prepareRun() {
    if (!prepared && game.phase() == SurvivalGame.Phase.COUNTDOWN) {
      world.prepare();
      map.reset();
      machines.prepare();
      prepared = true;
    }
  }

  private Collection<Survivor> expirePlayers() {
    var before = game.players();
    game.expire(context().time().instant());
    before.stream()
        .filter(p -> p.status() == Survivor.Status.DOWNED)
        .filter(
            p ->
                game.player(p.id())
                    .filter(next -> next.status() == Survivor.Status.WAITING)
                    .isPresent())
        .forEach(p -> waiting(p.id()));
    return before;
  }

  private void beginRound(Collection<Survivor> before) {
    if (before.stream().anyMatch(p -> p.status() == Survivor.Status.LOBBY)) announcements.started();
    map.state().nextRound();
    var spawnIndex = 0;
    prepareDebug(before);
    for (var survivor : game.players()) {
      var prior = before.stream().filter(old -> old.id().equals(survivor.id())).findFirst();
      var player = context().server().getPlayer(survivor.id());
      if (player == null || survivor.status() != Survivor.Status.STANDING) {
        continue;
      }
      if (prior.filter(old -> old.status() == Survivor.Status.WAITING).isPresent()) {
        items.equip(player, survivor.role(), true);
        actions.applyPerks(player);
        player.teleport(
            Places.location(
                world.world(),
                world
                    .definition()
                    .playerSpawns()
                    .get(spawnIndex++ % world.definition().playerSpawns().size())));
      } else if (prior.filter(old -> old.status() == Survivor.Status.LOBBY).isPresent()) {
        if (game.debug()) items.debug(player, game.startRound());
        player.teleport(
            Places.location(
                world.world(),
                world
                    .definition()
                    .playerSpawns()
                    .get(spawnIndex++ % world.definition().playerSpawns().size())));
        if (survivor.role() == SurvivalClass.BEASTMASTER) {
          talents.companions(player, 1);
        }
      }
    }
    combat.begin(game.round(), game.participants().size(), online());
  }

  private void prepareDebug(Collection<Survivor> before) {
    if (!game.debug() || before.stream().noneMatch(p -> p.status() == Survivor.Status.LOBBY))
      return;
    if (game.startRound() >= 4)
      map.content().zones().stream().filter(map.state()::unlockable).forEach(map::unlock);
    map.labels();
    machines.debug(game.startRound());
    talents.earned(game.startRound() - 1);
  }

  private void keepMembers() {
    for (var player : online()) {
      if (downed(player.getUniqueId())) continue;
      if (isFighter(player.getUniqueId())) {
        map.contain(player, combat::castDanger);
      } else if (player.getGameMode() == org.bukkit.GameMode.SPECTATOR) {
        if (!world.contains(Places.at(player)))
          player.teleport(Places.location(world.world(), world.definition().spectator()));
      } else if (!map.content().lobbyArea().contains(Places.point(Places.at(player)))
          && !player.isDead()
          && game.player(player.getUniqueId())
              .filter(p -> p.status() != Survivor.Status.JOINING)
              .isPresent()) {
        player.teleport(Places.location(world.world(), world.definition().lobby()));
      }
    }
  }

  private void outsiders() {
    for (var player : context().server().getOnlinePlayers()) {
      if (game.player(player.getUniqueId()).isEmpty()
          && !Staff.exempt(player)
          && world.contains(Places.at(player))) {
        player.teleport(exit());
      }
    }
  }

  private void revive() {
    for (var rescuer : fighters()) {
      var id = rescuer.getUniqueId();
      var target =
          online().stream()
              .filter(
                  p ->
                      game.player(p.getUniqueId())
                          .filter(s -> s.status() == Survivor.Status.DOWNED)
                          .isPresent())
              .filter(
                  p ->
                      Places.at(p).distanceSquared(Places.at(rescuer)) <= 9
                          && rescuer.hasLineOfSight(p))
              .findFirst();
      if (!rescuer.isSneaking() || target.isEmpty()) {
        revival.interrupt(id);
        continue;
      }
      var downed = target.orElseThrow();
      var seconds =
          actions.has(
                  rescuer,
                  com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.QUICK_REVIVE)
              ? 3
              : game.player(id).orElseThrow().role() == SurvivalClass.MEDIC ? 4 : 5;
      var complete = revival.channel(id, downed.getUniqueId(), context().time().instant(), seconds);
      var percent =
          (int) Math.round(revival.progress(id, context().time().instant(), seconds) * 100);
      hud.hint(rescuer, "Reviving " + downed.getName() + " · " + percent + "% · hold sneak", 2);
      hud.hint(downed, rescuer.getName() + " is reviving you · " + percent + "%", 2);
      if (complete) {
        revivePlayer(downed, 8);
        revival.interrupt(id);
        Texts.info(downed, "You were revived.");
      }
    }
  }

  void revivePlayer(Player player, double health) {
    if (!game.revive(player.getUniqueId())) return;
    player.setGameMode(GameMode.SURVIVAL);
    player.setHealth(
        Math.min(
            health,
            java.util.Objects.requireNonNull(
                    player.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH))
                .getValue()));
    player.setGlowing(false);
    player.setNoDamageTicks(40);
  }

  private void recover(Player player) {
    var health = player.getHealth();
    var maxHealth =
        java.util.Objects.requireNonNull(
                player.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH))
            .getValue();
    var next =
        recovery.recover(player.getUniqueId(), context().time().instant(), health, maxHealth);
    if (next > health) {
      player.setHealth(next);
    }
  }

  void hurt(Player player, double finalDamage) {
    if (finalDamage <= 0) return;
    revival.interrupt(player.getUniqueId());
    if (finalDamage > 0 && isFighter(player.getUniqueId())) {
      recovery.hurt(player.getUniqueId(), context().time().instant());
    }
    if (finalDamage < player.getHealth() || !isFighter(player.getUniqueId())) {
      return;
    }
    var self = game.down(player.getUniqueId(), context().time().instant());
    actions.losePerks(player);
    legendary.repeater().stop(player.getUniqueId());
    talents.interrupt(player.getUniqueId());
    machines.interrupt(player.getUniqueId());
    player.setHealth(self ? 10 : 1);
    player.setFireTicks(0);
    player.closeInventory();
    if (self) {
      player.setNoDamageTicks(80);
      Texts.info(player, "Your one self-revive was used.");
    } else {
      player.setGameMode(GameMode.ADVENTURE);
      player.setGlowing(true);
      Texts.info(
          player, "Downed! A teammate must sneak nearby for five seconds. Bleedout in 30 seconds.");
    }
    if (game.wiped()) {
      stop();
    }
  }

  void interrupted(UUID id) {
    revival.interrupt(id);
    machines.interrupt(id);
  }

  boolean downed(UUID id) {
    return game.player(id).filter(p -> p.status() == Survivor.Status.DOWNED).isPresent();
  }

  private void waiting(UUID id) {
    var player = context().server().getPlayer(id);
    if (player != null) {
      PlayerStates.wipe(player, GameMode.SPECTATOR);
      player.setGlowing(false);
      Texts.info(player, "You return next round with a weaker kit.");
    }
    world.removeWolves(id);
  }

  private void cleared() {
    var now = context().time().instant();
    talents.earned(game.round());
    for (var player : game.participants()) {
      if (game.debug()) continue;
      credit(new SurvivalProgress.Credit(player.id(), run, "round:" + game.round(), 10));
      context()
          .logFailure(
              services
                  .leaderboard()
                  .record(
                      new LeaderboardStore.Result(
                          player.id(), player.name(), id(), game.round(), now)),
              "record a survival round");
    }
    combat.reset();
    game.cleared(now);
    announcements.cleared();
    online()
        .forEach(
            p -> Texts.info(p, "Round " + game.round() + " cleared. Eight seconds to resupply."));
  }

  private void credit(SurvivalProgress.Credit credit) {
    if (game.debug()) return;
    context()
        .onMain(
            services.progress().credit(credit),
            total -> xp.merge(credit.player(), total, Math::max),
            "credit survival XP");
  }

  private void died(UUID id) {
    respawning.add(id);
    leave(id);
  }

  private void leave(UUID id) {
    machines.leave(id);
    talents.leave(id);
    legendary.leave(id);
    combat.leave(id);
    feedback.leave(id);
    game.leave(id);
    spectators.remove(id);
    revival.interrupt(id);
    recovery.remove(id);
    world.removeWolves(id);
    var player = context().server().getPlayer(id);
    if (player != null) {
      actions.losePerks(player);
      player.setGlowing(false);
      hud.leave(player);
      services.snapshots().restore(player);
    }
    actions.leave(id);
    items.bank().leave(id);
    if (!stopping && (game.participants().isEmpty() || game.wiped())) {
      stop();
    }
  }

  private void stop() {
    if (game.running()) announcements.ended();
    cancelStartup();
    if (!startup.isDone()) {
      startup.completeExceptionally(new IllegalStateException("Survival stopped during startup"));
    }
    stopping = true;
    try {
      combat.reset();
      drops.reset();
      machines.reset();
      legendary.reset();
      presentation.reset();
      if (prepared && world.chunksReady()) {
        map.reset();
      }
      var ids = game.players().stream().map(Survivor::id).toList();
      ids.forEach(this::leave);
      game.reset();
      announcements.reset();
      world.reset();
      revival.reset();
      recovery.reset();
      spectators.clear();
      prepared = false;
      run = runId();
      items = new SurvivalItems(services.keys(), run, feedback, map.content());
      combat = newCombat();
      actions = new SurvivalActions(this);
      machines = new ZombiesMachines(this);
      drops = new ZombiesDrops(this);
    } finally {
      stopping = false;
    }
  }

  @Override
  public boolean awaitsRespawn(UUID id) {
    return respawning.contains(id);
  }

  @Override
  public Location exit() {
    return Places.location(world.world(), world.definition().exit());
  }

  @Override
  public void respawned(Player player) {
    if (respawning.remove(player.getUniqueId())) {
      services.snapshots().restore(player);
    }
  }

  @Override
  public void quitWhileDead(UUID id) {
    respawning.remove(id);
  }

  @Override
  public boolean menu(UUID id, Inventory inventory) {
    return menus.owns(id, inventory) || classMenus.owns(id, inventory);
  }

  @Override
  public void announce(com.shepherdjerred.thestorm.arena.domain.game.Notice notice) {
    online().forEach(player -> Texts.info(player, notice.toString()));
  }
}
