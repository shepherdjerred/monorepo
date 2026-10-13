package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.RwfHarness;
import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.FakeMobGoals;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.DyeColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.FallingBlock;
import org.bukkit.entity.IronGolem;
import org.bukkit.entity.Wolf;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Killstreak rewards on MockBukkit through the real listeners: earned, used on a block, delivered
 * from the sky, and cleared when the match resets.
 */
final class KillstreaksPaperTest {

  @TempDir Path directory;
  private @Nullable RwfHarness harness;
  private @Nullable PlayerMock alicePlayer;
  private final List<PlayerMock> enemies = new ArrayList<>();

  @AfterEach
  void stop() {
    if (harness != null) {
      harness.close();
    }
  }

  /** Alice live as a Trooper, with the enemy team's bots beside her. */
  private RwfHarness live() {
    var started = RwfHarness.start(directory);
    harness = started;
    var alice = started.loadedPlayer("Alice");
    alicePlayer = alice;
    started.enter(alice);
    started.until(() -> started.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    started.letBotsArrive();
    started.tick(Duration.ofSeconds(36));
    started.until(() -> started.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    started.lookAround(alice);
    var team = started.combatant(alice).team().orElseThrow();
    var enemyTeam = team == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
    alice.teleport(new Location(started.rwf, 31.5, 65, 20.5));
    var x = 31.5;
    for (var bot : started.bots.spawned()) {
      var view = started.snapshot().combatant(started.bots.idOf(bot).orElseThrow());
      if (view.filter(v -> v.alive() && v.team().filter(enemyTeam::equals).isPresent())
          .isPresent()) {
        bot.teleport(new Location(started.rwf, x, 65, 22.5));
        x += 1;
        enemies.add(bot);
      }
    }
    return started;
  }

  private PlayerMock alice() {
    var player = alicePlayer;
    if (player == null) {
      throw new IllegalStateException("not started");
    }
    return player;
  }

  private MatchRunner runner() {
    return (MatchRunner) live().view();
  }

  private void kill(RwfHarness started, PlayerMock enemy) {
    for (var i = 0; i < 40 && !enemy.isDead() && enemy.getHealth() > 0; i++) {
      enemy.setNoDamageTicks(0);
      enemy.simulateDamage(1, alice());
      started.ticks(1);
    }
  }

  private void call(org.bukkit.event.Event event) {
    harness().server.getPluginManager().callEvent(event);
  }

  private RwfHarness harness() {
    var started = harness;
    if (started == null) {
      throw new IllegalStateException("not started");
    }
    return started;
  }

  /** Clears a spot on solid ground in front of Alice and right-clicks it with what she holds. */
  private Block useOnGround() {
    return useOnGround(Action.RIGHT_CLICK_BLOCK);
  }

  /** Clears a spot on solid ground in front of Alice and clicks it with what she holds. */
  private Block useOnGround(Action click) {
    var world = harness().rwf;
    var floor = world.getBlockAt(31, 64, 21);
    floor.setType(Material.STONE);
    floor.getRelative(BlockFace.UP).setType(Material.AIR);
    call(
        new PlayerInteractEvent(
            alice(),
            click,
            alice().getInventory().getItemInMainHand(),
            floor,
            BlockFace.UP,
            EquipmentSlot.HAND));
    return floor.getRelative(BlockFace.UP);
  }

  private TeamColor aliceTeam() {
    return harness().combatant(alice()).team().orElseThrow();
  }

  private FallingBlock landed(Block where) {
    var falling =
        harness().rwf.getEntitiesByClass(FallingBlock.class).stream().findFirst().orElseThrow();
    // MockBukkit does not fall: the block is put where it would come down.
    falling.teleport(
        new Location(where.getWorld(), where.getX() + 0.5, where.getY(), where.getZ() + 0.5));
    call(new EntityChangeBlockEvent(falling, where, falling.getBlockData()));
    return falling;
  }

  @Test
  void aSecondKillGivesTheTrackingCompass() {
    var started = live();
    assertThat(enemies).hasSizeGreaterThanOrEqualTo(2);

    kill(started, enemies.get(0));
    kill(started, enemies.get(1));
    started.ticks(2);

    assertThat(alice().getInventory().contains(Material.COMPASS)).isTrue();
    assertThat(RwfHarness.messages(alice())).contains("Killstreak of 2! Given a tracking compass!");
  }

  @Test
  void aSupplyCrateFallsFromTheSkyAndCanBeLooted() {
    var runner = runner();
    var streaks = runner.powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.SUPPLY_CRATE));

    var target = useOnGround();

    var falling =
        harness().rwf.getEntitiesByClass(FallingBlock.class).stream().findFirst().orElseThrow();
    assertThat(falling.getLocation().getY()).isGreaterThanOrEqualTo(target.getY() + 50);
    assertThat(alice().getInventory().contains(Material.REDSTONE)).isFalse();

    landed(target);

    assertThat(target.getType()).isEqualTo(Material.CHEST);
    assertThat(streaks.hasCrate(new BlockPos(target.getX(), target.getY(), target.getZ())))
        .isTrue();
    call(
        new PlayerInteractEvent(
            alice(), Action.RIGHT_CLICK_BLOCK, null, target, BlockFace.UP, EquipmentSlot.HAND));
    assertThat(alice().getInventory().contains(Material.COOKED_BEEF)).isTrue();
    assertThat(target.getType()).isEqualTo(Material.AIR);
  }

  @Test
  void aCarriedRewardIsCalledInAtTheFeetAsBotsDo() {
    var runner = runner();
    var streaks = runner.powers().streaks();
    var world = harness().rwf;
    world.getBlockAt(31, 64, 20).setType(Material.STONE);
    world.getBlockAt(31, 65, 20).setType(Material.AIR);
    alice().teleport(new Location(world, 31.5, 65, 20.5));
    alice().getInventory().addItem(streaks.item(Killstreak.IRON_GOLEM));
    var id = new CombatantId.Human(alice().getUniqueId());

    assertThat(harness().actions().useStreak(id)).isEmpty();

    assertThat(world.getEntitiesByClass(FallingBlock.class)).hasSize(1);
    assertThat(alice().getInventory().contains(Material.IRON_GOLEM_SPAWN_EGG)).isFalse();
    assertThat(harness().actions().useStreak(id)).contains(ActionRefusal.NO_KIT_ITEM);
  }

  @Test
  void attackDogsArriveAndGoWhenTheMatchResets() {
    var runner = runner();
    var streaks = runner.powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.WOLVES));

    landed(useOnGround());

    assertThat(harness().rwf.getEntitiesByClass(Wolf.class)).hasSize(3);
    assertThat(streaks.summons().all()).hasSize(3);

    runner.handle(new MatchEvent.Stop());
    harness().ticks(2);

    assertThat(streaks.summons().all()).isEmpty();
    assertThat(harness().rwf.getEntitiesByClass(Wolf.class)).noneMatch(Wolf::isValid);
  }

  @Test
  void theItemsAreNamedAsRedWarfareNamedThem() {
    var streaks = runner().powers().streaks();
    var crate = streaks.item(Killstreak.SUPPLY_CRATE).getItemMeta();
    assertThat(crate.displayName())
        .isEqualTo(
            Component.text("Supply Crate", NamedTextColor.RED)
                .decoration(TextDecoration.ITALIC, false));
    assertThat(crate.lore())
        .containsExactly(
            Component.text("Use this in a clear", NamedTextColor.GRAY)
                .decoration(TextDecoration.ITALIC, false),
            Component.text("area to receive supplies!", NamedTextColor.GRAY)
                .decoration(TextDecoration.ITALIC, false));
    assertThat(streaks.item(Killstreak.WOLVES).getItemMeta().displayName())
        .isEqualTo(
            Component.text("Summon attack dogs", NamedTextColor.GRAY)
                .decoration(TextDecoration.ITALIC, false));
  }

  @Test
  void anyTntInAFightersHandIsNapalmAndALeftClickCallsItIn() {
    runner();
    alice().getInventory().setItemInMainHand(new ItemStack(Material.TNT));
    RwfHarness.messages(alice());
    enemies.forEach(RwfHarness::messages);

    useOnGround(Action.LEFT_CLICK_BLOCK);

    assertThat(harness().rwf.getEntitiesByClass(FallingBlock.class)).hasSize(1);
    assertThat(alice().getInventory().contains(Material.TNT)).isFalse();
    assertThat(RwfHarness.messages(alice())).contains("Your team released napalm in the area!");
    assertThat(RwfHarness.messages(enemies.get(0)))
        .contains("Napalm has been unleased in the area by Alice! Get out!");
  }

  @Test
  void napalmSetsEnemiesAlightAndItsFireIsTheThrowers() {
    var streaks = runner().powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.NAPALM));
    var enemy = enemies.get(0);
    // Out of the blast's reach of 9, inside the fire's of 20.
    enemy.teleport(new Location(harness().rwf, 31.5, 65, 33.5));

    landed(useOnGround());

    assertThat(enemy.getFireTicks()).isPositive();
    assertThat(alice().getFireTicks()).isZero();
    assertThat(streaks.napalm().burning(enemy))
        .contains(new CombatantId.Human(alice().getUniqueId()));
    var before = enemy.getHealth();
    enemy.setNoDamageTicks(0);
    var burn = enemy.simulateDamage(1, DamageSource.builder(DamageType.ON_FIRE).build());
    assertThat(burn.isCancelled()).isTrue();
    assertThat(enemy.getHealth()).isLessThan(before);
  }

  @Test
  void attackDogsAreTamedByTheirOwnerInTheTeamsCollars() {
    var streaks = runner().powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.WOLVES));

    landed(useOnGround());

    var collar = aliceTeam() == TeamColor.RED ? DyeColor.RED : DyeColor.BLUE;
    assertThat(harness().rwf.getEntitiesByClass(Wolf.class))
        .hasSize(3)
        .allSatisfy(
            wolf -> {
              assertThat(wolf.getOwner()).isEqualTo(alice());
              assertThat(wolf.getCollarColor()).isEqualTo(collar);
              assertThat(wolf.getHealth()).isEqualTo(14);
              assertThat(wolf.getVariant()).isEqualTo(Wolf.Variant.PALE);
            });
  }

  @Test
  void aDogsBiteKnocksBackAndTheHitWindowStopsTheNext() {
    var streaks = runner().powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.WOLVES));
    landed(useOnGround());
    var dog = streaks.summons().all().getFirst();
    var enemy = enemies.get(0);
    enemy.setNoDamageTicks(0);
    var before = enemy.getHealth();

    assertThat(enemy.simulateDamage(6, dog.mob()).isCancelled()).isTrue();

    assertThat(enemy.getHealth()).isLessThan(before);
    assertThat(enemy.getVelocity().getY()).isPositive();
    var afterBite = enemy.getHealth();
    assertThat(enemy.simulateDamage(6, dog.mob()).isCancelled()).isTrue();
    assertThat(enemy.getHealth()).isEqualTo(afterBite);
  }

  @Test
  void anIronGolemThinksWithRedWarfaresGoalsAndThrowsItsVictimUp() {
    var streaks = runner().powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.IRON_GOLEM));

    landed(useOnGround());

    var golem =
        harness().rwf.getEntitiesByClass(IronGolem.class).stream().findFirst().orElseThrow();
    assertThat(golem.getHealth()).isEqualTo(20);
    assertThat(
            java.util.Objects.requireNonNull(golem.getAttribute(Attribute.MAX_HEALTH))
                .getBaseValue())
        .isEqualTo(40);
    var goals = harness().mobGoals;
    assertThat(goals.cleared(golem)).isTrue();
    assertThat(goals.goals(golem).stream().map(FakeMobGoals.Entry::priority).toList())
        .containsExactly(0, 2, 7, 8, 8, 2, 2);
    assertThat(
            goals.goals(golem).stream()
                .map(entry -> entry.goal().getKey().getNamespacedKey().getKey())
                .toList())
        .containsExactly(
            "rwf_golem_swim",
            "rwf_golem_melee",
            "rwf_golem_stroll",
            "rwf_golem_look_at_player",
            "rwf_golem_look_around",
            "rwf_golem_hunt_player",
            "rwf_golem_hunt_mob");

    var hunt = goals.goals(golem).get(5).goal();
    assertThat(hunt.shouldActivate()).isTrue();
    hunt.start();
    assertThat(golem.getTarget()).isEqualTo(enemies.get(0));

    var enemy = enemies.get(0);
    enemy.setNoDamageTicks(0);
    var before = enemy.getHealth();
    assertThat(enemy.simulateDamage(14, golem).isCancelled()).isTrue();
    assertThat(enemy.getHealth()).isLessThan(before);
    assertThat(enemy.getVelocity().getY()).isEqualTo(1);
  }

  @Test
  void aSummonNeverTakesItsOwnTeam() {
    var streaks = runner().powers().streaks();
    alice().getInventory().setItemInMainHand(streaks.item(Killstreak.WOLVES));
    landed(useOnGround());
    var dog = streaks.summons().all().getFirst();

    assertThat(streaks.summons().mayTarget(dog, alice())).isFalse();
    assertThat(streaks.summons().mayTarget(dog, enemies.get(0))).isTrue();
    assertThat(streaks.summons().prey(dog, alice())).isFalse();
  }
}
