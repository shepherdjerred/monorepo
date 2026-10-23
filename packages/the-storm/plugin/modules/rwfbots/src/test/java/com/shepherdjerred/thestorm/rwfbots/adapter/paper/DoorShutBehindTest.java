package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.DoorShut;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * A body fleeing east has just come through an open oak door at (10, 1, 5); it pulls the door shut
 * through the ordinary interaction event only while an enemy follows and no teammate does.
 */
final class DoorShutBehindTest {
  private static final Vec3 PAST = new Vec3(11.6, 1, 5.5);
  private static final Vec3 AWAY = new Vec3(18.5, 1, 5.5);
  private static final CombatantView CHASER =
      Fixtures.combatant(2, Fixtures.BLUE, new Vec3(5.5, 1, 5.5));

  private ServerMock server;
  private WorldMock world;
  private BodyDriver driver;
  private BotBody bot;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    var bodies = new FakeBodies(server);
    var time = java.time.InstantSource.fixed(java.time.Instant.EPOCH);
    driver =
        new BodyDriver(
            new BodyDriver.Parts(
                bodies,
                new FakeBotActions(),
                world,
                new StimulusCollector(
                    new com.shepherdjerred.thestorm.rwf.app.BattleSoundLog(time), time),
                body -> {},
                id -> false));
    var personality = Fixtures.personality("ash", "Ash_42", 0.5);
    var uuid = bodies.create(personality);
    bodies.spawn(uuid, new Location(world, PAST.x(), PAST.y(), PAST.z()));
    bot =
        new BotBody(
            uuid,
            new Director.Drafted(personality, Kit.LONGBOW, LeverCurves.at(0.5), Rating.DEFAULT));
    for (var y = 1; y <= 2; y++) {
      var data = (Door) Material.OAK_DOOR.createBlockData();
      data.setHalf(y == 1 ? Bisected.Half.BOTTOM : Bisected.Half.TOP);
      data.setOpen(true);
      world.getBlockAt(10, y, 5).setBlockData(data);
    }
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private static DoorShut.Escape escape(Vec3 next, List<CombatantView> allies) {
    var decision =
        new Decision(
            new CombatantId(1),
            Option.RETREAT,
            Optional.empty(),
            List.of(new Waypoint(next, Hop.WALK)),
            Stance.EVASIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "retreat:flee",
            100,
            0,
            Optional.empty());
    return new DoorShut.Escape(
        Fixtures.combatant(1, Fixtures.RED, PAST), decision, 0, List.of(CHASER), allies);
  }

  private boolean open(int y) {
    return ((Door) world.getBlockAt(10, y, 5).getBlockData()).isOpen();
  }

  @Test
  void aFleeingBodyShutsBothHalvesOfTheDoorBehindItWhenAnEnemyFollows() {
    assertThat(driver.shutDoorBehind(bot, escape(AWAY, List.of()))).isTrue();
    assertThat(open(1)).isFalse();
    assertThat(open(2)).isFalse();
    // Shut once; the next tick finds no open door to shut.
    assertThat(driver.shutDoorBehind(bot, escape(AWAY, List.of()))).isFalse();
  }

  @Test
  void aTeammateFollowingThroughKeepsTheDoorOpen() {
    var following = Fixtures.combatant(3, Fixtures.RED, new Vec3(7.5, 1, 5.5));
    assertThat(driver.shutDoorBehind(bot, escape(AWAY, List.of(following)))).isFalse();
    assertThat(open(1)).isTrue();
  }

  @Test
  void aBodyWhoseRouteGoesBackThroughTheDoorLeavesItOpen() {
    assertThat(driver.shutDoorBehind(bot, escape(new Vec3(10.5, 1, 5.5), List.of()))).isFalse();
    assertThat(open(1)).isTrue();
  }

  /** Denies every right click, as a rule that forbids using doors would. */
  public static final class NoDoors implements Listener {
    @EventHandler
    public void deny(PlayerInteractEvent event) {
      event.setUseInteractedBlock(Event.Result.DENY);
    }
  }

  @Test
  void aRuleThatDeniesTheClickKeepsTheDoorOpen() {
    server.getPluginManager().registerEvents(new NoDoors(), MockBukkit.createMockPlugin());
    assertThat(driver.shutDoorBehind(bot, escape(AWAY, List.of()))).isFalse();
    assertThat(open(1)).isTrue();
  }
}
