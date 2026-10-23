package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * Every body command reaches the body or the rules, and a released bow fires with vanilla force.
 */
final class BodyDriverTest {

  private ServerMock server;
  private WorldMock world;
  private FakeBodies bodies;
  private FakeBotActions actions;
  private StimulusCollector stimuli;
  private List<BotBody> rewound;
  private BodyDriver driver;
  private BotBody bot;
  private IdMap ids;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    bodies = new FakeBodies(server);
    actions = new FakeBotActions();
    var time = java.time.InstantSource.fixed(java.time.Instant.EPOCH);
    stimuli =
        new StimulusCollector(new com.shepherdjerred.thestorm.rwf.app.BattleSoundLog(time), time);
    rewound = new ArrayList<>();
    driver =
        new BodyDriver(
            new BodyDriver.Parts(bodies, actions, world, stimuli, rewound::add, id -> false));
    var personality = Fixtures.personality("ash", "Ash_42", 0.5);
    var drafted =
        new Director.Drafted(personality, Kit.LONGBOW, LeverCurves.at(0.5), Rating.DEFAULT);
    var uuid = bodies.create(personality);
    bodies.spawn(uuid, new Location(world, 5, 1, 5));
    bodies.orders();
    bot = new BotBody(uuid, drafted);
    ids = new IdMap();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private void apply(long tick, BodyCommand... commands) {
    driver.apply(bot, List.of(commands), ids, tick);
  }

  @Test
  void liveMovementRefusalPreventsItsPairedJumpButDoesNotSuppressAStandaloneJump() {
    for (var reason : List.of(MovementSafety.Reason.BLOCKED, MovementSafety.Reason.ARRIVED)) {
      var before = bodies.player(bot.uuid()).getLocation();
      bot.reflex(bot.reflex().withActiveJump(Optional.of(flight(1))));
      bodies.nextMovement(reason);
      apply(
          1, new BodyCommand.MoveToward(new Vec3(8, 1, 5), true, Hop.LEAP), new BodyCommand.Jump());
      assertThat(bodies.orders())
          .containsExactly(reason.name().toLowerCase(java.util.Locale.ROOT) + " Ash_42");
      assertThat(bodies.player(bot.uuid()).getLocation()).isEqualTo(before);
      assertThat(bot.reflex().activeJump()).isEmpty();
      apply(2, new BodyCommand.Jump());
      assertThat(bodies.orders()).containsExactly("jump Ash_42");
    }
  }

  @Test
  void aRefusedAirborneCorrectionRetainsTheFlightThatAlreadyOwnsNativeMomentum() {
    var active = flight(0);
    bot.reflex(bot.reflex().withActiveJump(Optional.of(active)));
    bodies.nextMovement(MovementSafety.Reason.BLOCKED);
    apply(1, new BodyCommand.MoveToward(new Vec3(8, 1, 5), true, Hop.LEAP));
    assertThat(bot.reflex().activeJump()).contains(active);
    assertThat(bodies.orders()).containsExactly("blocked Ash_42");
  }

  private static ActiveJump flight(long launchedAt) {
    var landing =
        new Waypoint(
            new Vec3(8, 1, 5),
            Hop.LEAP,
            Optional.of(new JumpLaunch(new Vec3(5, 1, 5), new Vec3(3, 1, 5), 0.27, 13)));
    return new ActiveJump(
        landing,
        new ActiveJump.Intent(Option.HUNT, landing.pos()),
        ActiveJump.Stage.AIRBORNE,
        0,
        launchedAt);
  }

  @Test
  void motionLookAndSlotsGoToTheBody() {
    apply(
        1,
        new BodyCommand.MoveToward(new Vec3(8, 1, 5), true),
        new BodyCommand.Jump(),
        new BodyCommand.Sneak(true),
        new BodyCommand.SelectSlot(2),
        new BodyCommand.Swing(),
        new BodyCommand.Stop(),
        new BodyCommand.Look(90, 10));

    assertThat(bodies.orders())
        .containsExactly(
            "look Ash_42",
            "move Ash_42 sprint",
            "jump Ash_42",
            "sneak Ash_42 true",
            "slot Ash_42 2",
            "swing Ash_42",
            "stop Ash_42");
    var player = bodies.player(bot.uuid());
    assertThat(player.getLocation().getX()).isCloseTo(5 + FakeBodies.STEP, within(1e-9));
    assertThat(player.getLocation().getYaw()).isEqualTo(90f);
    assertThat(player.getInventory().getHeldItemSlot()).isEqualTo(2);
    assertThat(actions.calls()).isEmpty();
  }

  @Test
  void attacksAndFuseClicksGoThroughTheRulesWithTheMatchIds() {
    var victim = UUID.randomUUID();
    var target = ids.combatant(victim);
    var bomb = ids.bomb("red-1");

    apply(1, new BodyCommand.Attack(target), new BodyCommand.ClickBomb(bomb));

    assertThat(actions.calls()).containsExactly("melee " + victim, "bomb red-1");
    assertThat(bot.refusals()).isZero();
  }

  @Test
  void aTacticalWindupHoldsLearnedMovementAndAttacksIncludingTheFrameThatStartsIt() {
    var casting = new java.util.concurrent.atomic.AtomicBoolean();
    driver =
        new BodyDriver(
            new BodyDriver.Parts(
                bodies, actions, world, stimuli, rewound::add, id -> casting.get()));
    actions.onKitUse(() -> casting.set(true));
    var enemy = ids.combatant(UUID.randomUUID());
    apply(
        1,
        new BodyCommand.UseKit(1, Optional.empty(), Optional.empty()),
        new BodyCommand.MoveToward(new Vec3(10, 1, 5), true),
        new BodyCommand.Attack(enemy));
    assertThat(actions.calls()).containsExactly("use 1");
    assertThat(bodies.orders()).containsExactly("stop Ash_42");
    apply(2, new BodyCommand.Attack(enemy), new BodyCommand.Jump(), new BodyCommand.UseStreak());
    assertThat(actions.calls()).isEmpty();
    assertThat(bodies.orders()).containsExactly("stop Ash_42");
    casting.set(false);
    apply(3, new BodyCommand.Attack(enemy));
    assertThat(actions.calls()).containsExactly("melee " + ids.uuid(enemy).orElseThrow());
  }

  @Test
  void refusalsAreCountedOnTheBot() {
    actions.refuseWith(Optional.of(ActionRefusal.OUT_OF_REACH));

    apply(1, new BodyCommand.Attack(ids.combatant(UUID.randomUUID())));

    assertThat(bot.refusals()).isEqualTo(1);
    assertThat(bot.lastRefusal()).contains(ActionRefusal.OUT_OF_REACH);
  }

  @Test
  void aBowReleasesThroughTheNativePortAlongTheTicksLook() {
    var bow = new org.bukkit.inventory.ItemStack(Material.BOW);
    bow.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.INFINITY, 1);
    bodies.player(bot.uuid()).getInventory().setItem(2, bow);
    bodies.player(bot.uuid()).getInventory().setHeldItemSlot(2);
    apply(10, new BodyCommand.StartUse());
    assertThat(bodies.orders()).isEmpty();
    assertThat(bot.drawStart()).isEqualTo(10);

    apply(30, new BodyCommand.ReleaseUse(), new BodyCommand.Look(0, -45));

    assertThat(bodies.orders()).containsExactly("look Ash_42");
    assertThat(actions.calls()).containsExactly("weapon START", "weapon RELEASE");
    assertThat(bot.drawStart()).isEqualTo(-1);
    assertThat(stimuli.drain()).isEmpty();
  }

  @Test
  void aFiniteBowUsesNativeAmmunitionInsteadOfTheSyntheticArrowPath() {
    bodies
        .player(bot.uuid())
        .getInventory()
        .setItem(2, new org.bukkit.inventory.ItemStack(Material.BOW));
    bodies.player(bot.uuid()).getInventory().setHeldItemSlot(2);
    apply(10, new BodyCommand.StartUse());
    apply(30, new BodyCommand.ReleaseUse());
    assertThat(actions.calls()).containsExactly("weapon START", "weapon RELEASE");
    assertThat(bodies.orders()).isEmpty();
  }

  @Test
  void aChargedCrossbowFiresWithASeparateNativeUseAfterRelease() {
    var crossbow = new org.bukkit.inventory.ItemStack(Material.CROSSBOW);
    crossbow.editMeta(
        org.bukkit.inventory.meta.CrossbowMeta.class,
        meta -> meta.addChargedProjectile(new org.bukkit.inventory.ItemStack(Material.ARROW)));
    bodies.player(bot.uuid()).getInventory().setItem(2, crossbow);
    bodies.player(bot.uuid()).getInventory().setHeldItemSlot(2);
    apply(30, new BodyCommand.ReleaseUse());
    assertThat(actions.calls()).containsExactly("weapon RELEASE", "weapon START");
  }

  @Test
  void aBarelyDrawnBowIsLetGoWithoutAnArrow() {
    bodies.using(bot.uuid(), Material.BOW, 1);
    bot.drawStart(10);

    apply(11, new BodyCommand.ReleaseUse());

    assertThat(bodies.orders()).containsExactly("release Ash_42");
    assertThat(actions.calls()).isEmpty();
  }

  @Test
  void aNearlyEatenAppleIsFinishedAndAnInterruptedOneDropped() {
    bodies.using(bot.uuid(), Material.GOLDEN_APPLE, 30);
    apply(40, new BodyCommand.ReleaseUse());
    assertThat(bodies.orders()).containsExactly("finish Ash_42");

    bodies.using(bot.uuid(), Material.GOLDEN_APPLE, 5);
    apply(41, new BodyCommand.ReleaseUse());
    assertThat(bodies.orders()).containsExactly("release Ash_42");
    assertThat(actions.calls()).isEmpty();
  }

  @Test
  void rewindGoesThroughTheRulesAndStartsANewLifeWhenItLands() {
    apply(1, new BodyCommand.UseAbility("rewind"));
    assertThat(actions.calls()).containsExactly("rewind");
    assertThat(rewound).containsExactly(bot);

    actions.refuseWith(Optional.of(ActionRefusal.COOLING_DOWN));
    apply(2, new BodyCommand.UseAbility("rewind"));
    assertThat(rewound).hasSize(1);
    assertThatThrownBy(() -> apply(3, new BodyCommand.UseAbility("blink")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void kitItemsGoThroughTheRulesAimedAndOnTheirTarget() {
    var victim = UUID.randomUUID();
    var target = ids.combatant(victim);
    bodies.orders();

    apply(
        1,
        new BodyCommand.Look(0, 0),
        new BodyCommand.UseKit(2, Optional.of(target), Optional.of(new Vec3(5.5, 1.62, 15))));
    apply(2, new BodyCommand.UseKit(3, Optional.empty(), Optional.empty()));

    assertThat(actions.calls()).containsExactly("use 2 on " + victim + " at 5.5,1.6,15.0", "use 3");
    // Looked at the point to use the item, then back along the tick's own look.
    assertThat(bodies.orders()).filteredOn(order -> order.startsWith("look")).hasSize(3);
  }

  @Test
  void aKillstreakRewardIsCalledInThroughTheRules() {
    apply(1, new BodyCommand.UseStreak());

    assertThat(actions.calls()).containsExactly("streak");
  }

  @Test
  void forceFollowsVanilla() {
    assertThat(BodyDriver.force(0)).isZero();
    assertThat(BodyDriver.force(5)).isCloseTo((0.0625 + 0.5) / 3, within(1e-9));
    assertThat(BodyDriver.force(20)).isEqualTo(1);
    assertThat(BodyDriver.force(40)).isEqualTo(1);
  }

  @Test
  void typingStopsVoluntaryActionsAndFuseWorkCancelsItImmediately() {
    var activity =
        new BodyActivity() {
          boolean busy = true;

          @Override
          public boolean typing(UUID uuid) {
            return busy;
          }

          @Override
          public void cancel(UUID uuid) {
            busy = false;
          }
        };
    driver.communication(activity);
    var target = ids.combatant(new UUID(0, 9));
    apply(
        1,
        new BodyCommand.MoveToward(new Vec3(8, 1, 5), true),
        new BodyCommand.Attack(target),
        new BodyCommand.UseStreak());
    assertThat(bodies.orders()).containsExactly("stop Ash_42");
    assertThat(actions.calls()).isEmpty();
    apply(2, new BodyCommand.ClickBomb(ids.bomb("red-1")));
    assertThat(activity.busy).isFalse();
    assertThat(actions.calls()).containsExactly("bomb red-1");
  }

  @Test
  void fallingCancelsSpeechBeforeTheDriverAppliesLandingMovement() {
    var activity =
        new BodyActivity() {
          boolean busy = true;

          @Override
          public boolean typing(UUID uuid) {
            return busy;
          }

          @Override
          public void cancel(UUID uuid) {
            busy = false;
          }
        };
    driver.communication(activity);
    var self = Fixtures.combatant(1, Fixtures.RED, new Vec3(5, 1, 5));
    self = self.withTraversal(self.traversal().withFallDistance(0.25));
    var snapshot =
        new com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot(
            2,
            com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase.LIVE,
            List.of(self),
            List.of(),
            com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView.NONE,
            "test",
            List.of(),
            List.of());
    var input =
        new com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput(
            self,
            snapshot,
            com.shepherdjerred.thestorm.rwfbots.domain.world.Decision.idle(self.id(), 2, 0),
            Optional.empty(),
            0);
    assertThat(BotTicker.communicationPaused(bot, input, activity)).isFalse();
    apply(
        2,
        new BodyCommand.MoveToward(
            new Vec3(8, 1, 5), true, com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.LEAP));
    assertThat(activity.busy).isFalse();
    assertThat(bodies.orders()).containsExactly("move Ash_42 sprint");
  }

  @Test
  void aShieldGetsItsWarmupAndHoldBeforeTheSwordCounterattack() {
    bodies
        .player(bot.uuid())
        .getInventory()
        .setItem(2, new org.bukkit.inventory.ItemStack(Material.SHIELD));
    var target = ids.combatant(new UUID(0, 9));
    apply(
        1,
        new BodyCommand.UseKit(2, Optional.of(target), Optional.empty()),
        new BodyCommand.SelectSlot(0),
        new BodyCommand.Attack(target));
    assertThat(actions.calls()).containsExactly("use 2 on " + new UUID(0, 9));
    assertThat(bodies.orders()).doesNotContain("slot Ash_42 0");
    apply(6, new BodyCommand.SelectSlot(0), new BodyCommand.Attack(target));
    assertThat(actions.calls()).isEmpty();
    apply(13, new BodyCommand.SelectSlot(0), new BodyCommand.Attack(target));
    assertThat(actions.calls()).containsExactly("weapon CANCEL", "melee " + new UUID(0, 9));
    assertThat(bodies.orders()).contains("slot Ash_42 0");
  }

  @Test
  void aFuseOrLethalDangerEndsShieldCommitment() {
    bot.shieldUntil(30);
    apply(2, new BodyCommand.ClickBomb(ids.bomb("red-1")));
    assertThat(actions.calls()).containsExactly("weapon CANCEL", "bomb red-1");
    bot.shieldUntil(30);
    bodies.player(bot.uuid()).setHealth(5);
    apply(3, new BodyCommand.UseStreak());
    assertThat(actions.calls()).containsExactly("weapon CANCEL", "streak");
    bot.newLife(com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing.SOUTH);
    assertThat(bot.shieldUntil()).isZero();
  }

  @Test
  void aBotsLoadoutFollowsTheKitItNowPlays() {
    // A bot drafted as a longbow but switched to a trooper in the lobby kept the longbow's
    // loadout, and one switched onto a crossbow never drew it.
    assertThat(bot.loadout(Kit.LONGBOW).hasBow()).isTrue();
    assertThat(bot.loadout(Kit.TROOPER).hasBow()).isFalse();
    assertThat(bot.loadout().hasBow()).as("the slots it may hold follow too").isFalse();
    assertThat(bot.loadout(Kit.LONGBOW).hasBow()).isTrue();
  }
}
