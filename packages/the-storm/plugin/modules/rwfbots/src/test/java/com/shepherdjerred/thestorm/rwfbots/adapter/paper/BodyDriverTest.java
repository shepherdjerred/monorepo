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
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
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
    stimuli = new StimulusCollector();
    rewound = new ArrayList<>();
    driver = new BodyDriver(new BodyDriver.Parts(bodies, actions, world, stimuli, rewound::add));
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
  void refusalsAreCountedOnTheBot() {
    actions.refuseWith(Optional.of(ActionRefusal.OUT_OF_REACH));

    apply(1, new BodyCommand.Attack(ids.combatant(UUID.randomUUID())));

    assertThat(bot.refusals()).isEqualTo(1);
    assertThat(bot.lastRefusal()).contains(ActionRefusal.OUT_OF_REACH);
  }

  @Test
  void aBowDrawnTwentyTicksFiresAtFullForceAlongTheTicksLook() {
    bodies
        .player(bot.uuid())
        .getInventory()
        .setItem(2, new org.bukkit.inventory.ItemStack(Material.BOW));
    bodies.player(bot.uuid()).getInventory().setHeldItemSlot(2);
    apply(10, new BodyCommand.StartUse());
    assertThat(bodies.orders()).containsExactly("use Ash_42 BOW");
    assertThat(bot.drawStart()).isEqualTo(10);

    apply(30, new BodyCommand.ReleaseUse(), new BodyCommand.Look(0, -45));

    assertThat(bodies.orders()).containsExactly("look Ash_42", "release Ash_42");
    assertThat(actions.calls()).containsExactly("shoot 0.00,0.71,0.71 force 1.000");
    assertThat(bot.drawStart()).isEqualTo(-1);
    assertThat(stimuli.drain()).hasSize(1);
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
  void forceFollowsVanilla() {
    assertThat(BodyDriver.force(0)).isZero();
    assertThat(BodyDriver.force(5)).isCloseTo((0.0625 + 0.5) / 3, within(1e-9));
    assertThat(BodyDriver.force(20)).isEqualTo(1);
    assertThat(BodyDriver.force(40)).isEqualTo(1);
  }
}
