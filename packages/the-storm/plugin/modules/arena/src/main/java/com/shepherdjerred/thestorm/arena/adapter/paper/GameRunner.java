package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.RewardPayer;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect;
import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.arena.domain.reward.VaultSettings;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;

/**
 * Runs one arena: feeds events to its {@link ArenaGame} and carries out the effects, in order.
 * Events raised while effects are being carried out wait their turn. Main thread only.
 */
final class GameRunner {

  private final ArenaWorld world;
  private final Services services;
  private final Set<UUID> awaitingRespawn = new HashSet<>();
  private final ArrayDeque<GameEvent> waiting = new ArrayDeque<>();
  private ArenaGame game;
  private boolean applying;

  /**
   * What a runner uses besides its world.
   *
   * @param context the shared server services
   * @param snapshots every arena's snapshots
   * @param items the arena's item stacks
   * @param classes the classes
   * @param texts messages
   * @param payer pays wave rewards
   * @param formatter formats crystal amounts
   * @param leaderboard best waves
   * @param rewards vault claims
   * @param vault the vault milestones
   */
  record Services(
      PaperContext context,
      Snapshots snapshots,
      ItemFactory items,
      ClassBook classes,
      Texts texts,
      RewardPayer payer,
      CrystalFormatter formatter,
      LeaderboardStore leaderboard,
      RewardStore rewards,
      VaultSettings vault) {}

  GameRunner(ArenaWorld world, Services services, ArenaGame game) {
    this.world = world;
    this.services = services;
    this.game = game;
  }

  String id() {
    return world.definition().id();
  }

  ArenaWorld world() {
    return world;
  }

  ArenaGame game() {
    return game;
  }

  Optional<Member> member(UUID player) {
    return game.member(player);
  }

  boolean isFighter(UUID player) {
    return member(player).filter(Member.Fighter.class::isInstance).isPresent();
  }

  /** Applies {@code event}, or returns why it was refused. */
  Optional<GameError> handle(GameEvent event) {
    if (applying) {
      waiting.add(event);
      return Optional.empty();
    }
    var refusal =
        switch (game.on(event)) {
          case Result.Err<ArenaGame.Step, GameError>(var error) -> Optional.of(error);
          case Result.Ok<ArenaGame.Step, GameError>(var step) -> {
            game = step.game();
            applying = true;
            try {
              step.effects().forEach(this::apply);
            } finally {
              applying = false;
            }
            yield Optional.<GameError>empty();
          }
        };
    while (!waiting.isEmpty()) {
      handle(waiting.poll());
    }
    return refusal;
  }

  /** One second of the arena: containment, custom AI, the boss, then the game's clock. */
  void tick() {
    var alive = world.alive();
    if (game.phase().running()) {
      world.contain();
      var fighters = online(game.fighters().stream().map(Member::id).toList());
      world.think(fighters);
      world.tickBoss(services.context().time().instant(), fighters, online(audience()));
    }
    keepInside();
    if (game.phase().running()) {
      keepOutsidersOut();
    }
    handle(new GameEvent.Tick(services.context().time().instant(), alive));
  }

  /** Members who wandered or were pushed out of the region go back to where they belong. */
  private void keepInside() {
    for (var member : game.members()) {
      var player = services.context().server().getPlayer(member.id());
      if (player == null || world.contains(Places.at(player)) || player.isDead()) {
        continue;
      }
      anchor(member).ifPresent(player::teleport);
    }
  }

  /** Players not in this game who got into its region while it runs are sent to the exit. */
  private void keepOutsidersOut() {
    for (var player : services.context().server().getOnlinePlayers()) {
      if (game.member(player.getUniqueId()).isEmpty()
          && !player.isDead()
          && world.contains(Places.at(player))) {
        player.teleport(exit());
        Texts.error(player, "A game is under way in that arena. Use /arena spec to watch.");
      }
    }
  }

  private Optional<Location> anchor(Member member) {
    var definition = world.definition();
    return switch (member) {
      case Member.Pending _ -> Optional.empty();
      case Member.InLobby _ -> Optional.of(Places.location(world.world(), definition.lobby()));
      case Member.Fighter _ ->
          Optional.of(Places.location(world.world(), definition.playerSpawns().getFirst()));
      case Member.Watcher _ -> Optional.of(Places.location(world.world(), definition.spectator()));
    };
  }

  private List<UUID> audience() {
    return game.members().stream()
        .filter(member -> !(member instanceof Member.Pending))
        .map(Member::id)
        .toList();
  }

  private List<Player> online(List<UUID> ids) {
    var server = services.context().server();
    return ids.stream().map(server::getPlayer).filter(Objects::nonNull).toList();
  }

  /** Whether {@code player} died in this arena and is waiting to respawn and be restored. */
  boolean awaitsRespawn(UUID player) {
    return awaitingRespawn.contains(player);
  }

  /** Where a player who died here respawns: the exit, outside the region. */
  Location exit() {
    return Places.location(world.world(), world.definition().exit());
  }

  /** The player respawned after dying here: restore them. */
  void respawned(Player player) {
    if (awaitingRespawn.remove(player.getUniqueId())) {
      services.snapshots().restore(player);
    }
  }

  /** The player quit while waiting to respawn: their snapshot is restored when they return. */
  void quitWhileDead(UUID player) {
    awaitingRespawn.remove(player);
  }

  /** Tells everyone in the arena something. */
  void announce(Notice notice) {
    online(audience()).forEach(player -> services.texts().notice(player, notice));
  }

  private void apply(GameEffect effect) {
    switch (effect) {
      case GameEffect.CaptureSnapshot capture -> capture(capture.player());
      case GameEffect.ForgetSnapshot forget -> services.snapshots().forget(forget.player());
      case GameEffect.EnterLobby enter ->
          withPlayer(
              enter.player(),
              player -> {
                PlayerStates.wipe(player, GameMode.SURVIVAL);
                player.teleport(Places.location(world.world(), world.definition().lobby()));
              });
      case GameEffect.EnterSpectator enter ->
          withPlayer(
              enter.player(),
              player -> {
                PlayerStates.wipe(player, GameMode.SPECTATOR);
                player.teleport(Places.location(world.world(), world.definition().spectator()));
              });
      case GameEffect.Equip equip ->
          withPlayer(equip.player(), player -> equip(player, equip.kit()));
      case GameEffect.Upgrade upgrade ->
          withPlayer(upgrade.player(), player -> upgrade(player, upgrade.kit()));
      case GameEffect.SendToArena send -> withPlayer(send.player(), player -> send(player, send));
      case GameEffect.Restore restore -> restore(restore.player());
      case GameEffect.RestoreAfterRespawn restore -> {
        world.removeWolves(restore.player());
        awaitingRespawn.add(restore.player());
      }
      case GameEffect.Announce announce ->
          online(announce.to())
              .forEach(player -> services.texts().notice(player, announce.notice()));
      case GameEffect.PrepareArena _ -> world.prepare();
      case GameEffect.SpawnBoss spawn -> {
        if (!world.spawnBoss(spawn.boss(), services.context().time().instant())) {
          spawnRefused();
        }
      }
      case GameEffect.Spawn spawn -> {
        if (!world.spawn(spawn.units())) {
          spawnRefused();
        }
      }
      case GameEffect.PayReward pay -> pay(pay);
      case GameEffect.ClaimVault claim -> claimVault(claim.player(), claim.wave());
      case GameEffect.RecordBestWave record ->
          services
              .context()
              .logFailure(
                  services
                      .leaderboard()
                      .record(
                          new LeaderboardStore.Result(
                              record.player(),
                              record.name(),
                              id(),
                              record.wave(),
                              services.context().time().instant())),
                  "record " + record.name() + "'s best wave");
      case GameEffect.ResetArena _ -> world.reset();
    }
  }

  private void withPlayer(UUID id, Consumer<Player> action) {
    var player = services.context().server().getPlayer(id);
    if (player != null) {
      action.accept(player);
    }
  }

  /**
   * Another plugin or a protection refused an arena mob's spawn. A wave with missing mobs would
   * look cleared, so the game stops (everyone is restored) and the failure is logged loudly.
   */
  private void spawnRefused() {
    services
        .context()
        .logger()
        .error(
            "Arena {} could not spawn its mobs (a spawn was cancelled or the mob removed at once);"
                + " stopping the game. Check that land protection allows CUSTOM spawns there.",
            id());
    online(audience())
        .forEach(
            player -> Texts.error(player, "The arena's mobs could not spawn; the game stopped."));
    handle(new GameEvent.Stop());
  }

  private void capture(UUID id) {
    var player = services.context().server().getPlayer(id);
    if (player == null) {
      handle(new GameEvent.SnapshotFailed(id));
      return;
    }
    services
        .snapshots()
        .capture(
            player,
            id(),
            stored -> {
              if (stored) {
                handle(new GameEvent.SnapshotStored(id));
              } else {
                Texts.error(player, "Your belongings could not be saved, so you were not let in.");
                handle(new GameEvent.SnapshotFailed(id));
              }
            });
  }

  private void equip(Player player, String kit) {
    var arenaClass = services.classes().require(kit);
    PlayerStates.wipe(player, GameMode.SURVIVAL);
    var inventory = player.getInventory();
    for (var spec : arenaClass.items()) {
      var stack = services.items().arenaItem(spec);
      spec.slot()
          .ifPresentOrElse(
              slot -> inventory.setItem(MobFactory.slot(slot), stack),
              () -> inventory.addItem(stack));
    }
    arenaClass
        .effects()
        .forEach(
            (key, amplifier) ->
                player.addPotionEffect(
                    new PotionEffect(
                        ItemFactory.effect(key).orElseThrow(),
                        PotionEffect.INFINITE_DURATION,
                        amplifier)));
  }

  private void upgrade(Player player, String kit) {
    var stacks =
        services.classes().require(kit).upgrade().stream()
            .map(services.items()::arenaItem)
            .toArray(ItemStack[]::new);
    player.getInventory().addItem(stacks);
  }

  private void send(Player player, GameEffect.SendToArena send) {
    player.teleport(
        Places.location(world.world(), world.definition().playerSpawns().get(send.spawn())));
    var wolves = services.classes().require(send.kit()).wolves();
    if (wolves > 0) {
      world.spawnWolves(player, wolves);
    }
  }

  private void restore(UUID id) {
    world.removeWolves(id);
    awaitingRespawn.remove(id);
    var player = services.context().server().getPlayer(id);
    if (player == null) {
      // Their snapshot stays held and stored, and is restored when they next join.
      return;
    }
    // A dead player is restored once they respawn.
    services.snapshots().restore(player);
  }

  private void pay(GameEffect.PayReward pay) {
    services
        .context()
        .onMain(
            services.payer().pay(id(), pay.player(), pay.crystals(), pay.wave()),
            result ->
                withPlayer(
                    pay.player(),
                    player -> {
                      if (result.isOk()) {
                        services
                            .texts()
                            .notice(
                                player,
                                Notice.of(
                                    NoticeKind.REWARD,
                                    Map.of(
                                        "amount",
                                        services.formatter().words(Crystals.of(pay.crystals())),
                                        "wave",
                                        String.valueOf(pay.wave()))));
                      } else {
                        services.context().logger().error("Arena reward refused: {}", result);
                        Texts.error(player, "Your wave reward could not be paid; tell an admin.");
                      }
                    }),
            "pay an arena reward");
  }

  private void claimVault(UUID id, int wave) {
    var milestone = services.vault().at(wave).orElseThrow();
    var stacks =
        milestone.loot().roll(services.context().random()).stream()
            .map(services.items()::reward)
            .toArray(ItemStack[]::new);
    var now = services.context().time().instant();
    var claim =
        new RewardStore.VaultClaim(
            id,
            wave,
            services.vault().day(now),
            ItemData.of(ItemStack.serializeItemsAsBytes(stacks)),
            now);
    services
        .context()
        .onMain(
            services.rewards().claimVault(claim),
            outcome ->
                withPlayer(
                    id,
                    player ->
                        services
                            .texts()
                            .notice(
                                player,
                                Notice.of(
                                    outcome == RewardStore.Claim.OPENED
                                        ? NoticeKind.VAULT_OPENED
                                        : NoticeKind.VAULT_ALREADY_OPENED,
                                    "wave",
                                    wave))),
            "open an arena vault");
  }

  /** Every item spec this runner may hand out, for building at enable. */
  static List<ItemSpec> specs(ClassBook classes) {
    return classes.classes().values().stream()
        .flatMap(c -> Stream.concat(c.items().stream(), c.upgrade().stream()))
        .toList();
  }
}
