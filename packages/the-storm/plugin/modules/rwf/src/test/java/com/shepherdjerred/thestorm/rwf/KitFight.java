package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.rwf.adapter.db.JooqKitStore;
import com.shepherdjerred.thestorm.rwf.app.shop.Purchase;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * A live match on MockBukkit with Alice on a chosen kit and a bot enemy beside her, for kit tests:
 * Alice owns the kit before she joins, picks it in the lobby and the match goes live with bots.
 */
public final class KitFight implements AutoCloseable {

  public final RwfHarness harness;
  public final PlayerMock alice;
  public final CombatantId.Human aliceId;
  public final PlayerMock enemy;
  public final CombatantId.Bot enemyId;

  private KitFight(
      RwfHarness harness, PlayerMock alice, PlayerMock enemy, CombatantId.Bot enemyId) {
    this.harness = harness;
    this.alice = alice;
    this.aliceId = new CombatantId.Human(alice.getUniqueId());
    this.enemy = enemy;
    this.enemyId = enemyId;
  }

  /**
   * Alice goes live on {@code kit}, standing two blocks from a living enemy bot. Each fight gets
   * its own folder under {@code directory}, so a test may run more than one.
   */
  public static KitFight on(Path directory, String kit) {
    return on(directory, kit, Optional.empty());
  }

  /** As {@link #on(Path, String)}, with every bot fighting as {@code botKit}. */
  public static KitFight on(Path directory, String kit, String botKit) {
    return on(directory, kit, Optional.of(botKit));
  }

  private static KitFight on(Path directory, String kit, Optional<String> botKit) {
    var folder = directory.resolve(kit + "-" + UUID.randomUUID());
    var harness = RwfHarness.start(folder);
    try {
      return live(harness, kit, botKit);
    } catch (RuntimeException | AssertionError e) {
      harness.close();
      throw e;
    }
  }

  private static KitFight live(RwfHarness harness, String kit, Optional<String> botKit) {
    var alice = harness.loadedPlayer("Alice");
    own(harness, alice.getUniqueId(), kit);
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.until(
        () -> {
          alice.performCommand("rwf kit " + kit);
          return harness.combatant(alice).kit().filter(kit::equals).isPresent();
        });
    harness.letBotsArrive();
    botKit.ifPresent(
        each -> {
          for (var bot : harness.bots.spawned()) {
            var id = harness.bots.idOf(bot).orElseThrow();
            if (harness.actions().pickKit(id, each).isPresent()) {
              throw new AssertionError("a bot could not pick " + each);
            }
          }
        });
    harness.tick(Duration.ofSeconds(36));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    harness.lookAround(alice);
    var team = harness.combatant(alice).team().orElseThrow();
    var enemyTeam = team == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
    for (var bot : harness.bots.spawned()) {
      var id = harness.bots.idOf(bot).orElseThrow();
      var view = harness.snapshot().combatant(id);
      if (view.isPresent()
          && view.orElseThrow().alive()
          && view.orElseThrow().team().filter(enemyTeam::equals).isPresent()) {
        alice.teleport(new Location(harness.rwf, 31.5, 65, 20.5));
        bot.teleport(new Location(harness.rwf, 31.5, 65, 22.5));
        return new KitFight(harness, alice, bot, id);
      }
    }
    throw new AssertionError("no enemy bot went live");
  }

  /** Records that {@code player} owns {@code kit}, as a finished purchase would. */
  static void own(RwfHarness harness, UUID player, String kit) {
    var store = new JooqKitStore(harness.database);
    var purchase = new Purchase(UUID.randomUUID(), player, kit, 1, Samples.T0);
    if (store.begin(purchase).join()) {
      store.grant(purchase.id(), Samples.T0).join();
    }
  }

  /** A second living enemy bot, standing three blocks from Alice. */
  PlayerMock anotherEnemy() {
    var team = harness.snapshot().combatant(enemyId).orElseThrow().team().orElseThrow();
    for (var bot : harness.bots.spawned()) {
      var id = harness.bots.idOf(bot).orElseThrow();
      var view = harness.snapshot().combatant(id);
      if (!id.equals(enemyId)
          && view.isPresent()
          && view.orElseThrow().alive()
          && view.orElseThrow().team().filter(team::equals).isPresent()) {
        bot.teleport(new Location(harness.rwf, 33.5, 65, 20.5));
        return bot;
      }
    }
    throw new AssertionError("no second enemy bot");
  }

  /** A living bot on Alice's team, standing at {@code x, z} on a stone floor at y 64. */
  PlayerMock ally(double x, double z) {
    var team = harness.combatant(alice).team().orElseThrow();
    for (var bot : harness.bots.spawned()) {
      var id = harness.bots.idOf(bot).orElseThrow();
      var view = harness.snapshot().combatant(id);
      if (view.isPresent()
          && view.orElseThrow().alive()
          && view.orElseThrow().team().filter(team::equals).isPresent()) {
        var floor = harness.rwf.getBlockAt((int) Math.floor(x), 64, (int) Math.floor(z));
        floor.setType(Material.STONE);
        floor.getRelative(0, 1, 0).setType(Material.AIR);
        floor.getRelative(0, 2, 0).setType(Material.AIR);
        bot.teleport(new Location(harness.rwf, x, 65, z));
        return bot;
      }
    }
    throw new AssertionError("no allied bot went live");
  }

  /** The id of the bot {@code bot}. */
  CombatantId.Bot botId(PlayerMock bot) {
    return harness.bots.idOf(bot).orElseThrow();
  }

  /** The hotbar slot Alice's kit puts {@code material} in. */
  public int slotOf(String kit, String material) {
    return com.shepherdjerred.thestorm.rwf.app.view.KitHotbar.of(kit).orElseThrow().slots().stream()
        .filter(slot -> slot.material().equals(material))
        .findFirst()
        .orElseThrow()
        .slot();
  }

  /** Whether the first enemy is still alive. */
  boolean enemyAlive() {
    return harness.snapshot().combatant(enemyId).filter(c -> c.alive()).isPresent();
  }

  /** Alice strikes the enemy once, as a melee hit through the server's damage event. */
  void aliceHits() {
    enemy.setNoDamageTicks(0);
    enemy.simulateDamage(1, alice);
  }

  /** The enemy strikes Alice once. */
  void enemyHits() {
    alice.setNoDamageTicks(0);
    alice.simulateDamage(1, enemy);
  }

  /** What {@code player} holds in inventory slot {@code slot}, AIR when it is empty. */
  static Material at(PlayerMock player, int slot) {
    var stack = player.getInventory().getItem(slot);
    return stack == null ? Material.AIR : stack.getType();
  }

  static double maxHealth(PlayerMock player) {
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new AssertionError("players have max health");
    }
    return attribute.getValue();
  }

  @Override
  public void close() {
    harness.close();
  }
}
