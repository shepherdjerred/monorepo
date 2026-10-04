package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** The capture reads the live entities into the bots' world, tick after tick. */
final class SnapshotCaptureTest {

  private static final UUID MATCH = UUID.fromString("00000000-0000-0000-0000-0000000000ff");

  private ServerMock server;
  private WorldMock world;
  private PlayerMock alice;
  private PlayerMock bob;
  private StimulusCollector stimuli;
  private IdMap ids;
  private SnapshotCapture capture;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    for (var x = 0; x < 32; x++) {
      for (var z = 0; z < 32; z++) {
        world.getBlockAt(x, 0, z).setType(Material.STONE);
      }
    }
    alice = server.addPlayer("Alice");
    bob = server.addPlayer("Bob");
    alice.teleport(new Location(world, 2.5, 1, 2.5, 90, 10));
    bob.teleport(new Location(world, 10.5, 1, 2.5, 0, 0));
    stimuli = new StimulusCollector();
    ids = new IdMap();
    capture =
        new SnapshotCapture(
            ids, uuid -> Optional.<Player>ofNullable(server.getPlayer(uuid)), stimuli);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private MatchState state(MatchState.Phase phase, Optional<MatchState.Poison> poison) {
    return new MatchState(
        MATCH,
        phase,
        Optional.of("synthetic"),
        List.of("red", "blue"),
        List.of(
            new MatchState.Fighter(
                alice.getUniqueId(),
                "Alice",
                Optional.empty(),
                Optional.of("red"),
                Optional.of("trooper"),
                true),
            new MatchState.Fighter(
                bob.getUniqueId(),
                "Bob",
                Optional.of("ash"),
                Optional.of("blue"),
                Optional.of("longbow"),
                true),
            new MatchState.Fighter(
                UUID.randomUUID(),
                "Gone",
                Optional.empty(),
                Optional.of("blue"),
                Optional.of("trooper"),
                true)),
        List.of(
            new MatchState.Bomb(
                "red-1", false, Optional.of("red"), 4, 1, 16, new MatchState.Status.Idle()),
            new MatchState.Bomb(
                "nuke-1",
                true,
                Optional.empty(),
                16,
                1,
                16,
                new MatchState.Status.Armed(
                    30,
                    Optional.of(
                        new MatchState.Status.Working("blue", 0.5, List.of(bob.getUniqueId())))))),
        poison,
        Optional.empty());
  }

  @Test
  void combatantsBombsAndIdsComeFromTheEntitiesAndTheMatch() {
    var snapshot = capture.capture(1, state(MatchState.Phase.LIVE, Optional.empty()));

    assertThat(snapshot.matchPhase()).isEqualTo(MatchPhase.LIVE);
    assertThat(snapshot.mapId()).isEqualTo("synthetic");
    assertThat(snapshot.combatants()).as("the absent entity is left out").hasSize(2);
    var a = snapshot.require(ids.combatant(alice.getUniqueId()));
    assertThat(a.team().value()).isEqualTo("red");
    assertThat(a.kit()).isEqualTo(Kit.TROOPER);
    assertThat(a.pos()).isEqualTo(new Vec3(2.5, 1, 2.5));
    assertThat(a.yaw()).isEqualTo(90);
    assertThat(a.pitch()).isEqualTo(10);
    assertThat(a.health()).isEqualTo(20);
    assertThat(a.onGround()).isTrue();
    assertThat(a.lastHurtTick()).isEqualTo(-1);
    assertThat(a.vel()).isEqualTo(Vec3.ZERO);
    var red = snapshot.bomb(ids.bomb("red-1")).orElseThrow();
    assertThat(red.owner()).isEqualTo(new BombOwner.Team(IdMap.team("red")));
    assertThat(red.pos()).isEqualTo(new Vec3(4.5, 1.5, 16.5));
    var nuke = snapshot.bomb(ids.bomb("nuke-1")).orElseThrow();
    assertThat(nuke.owner()).isEqualTo(new BombOwner.Nuke());
    assertThat(nuke.state()).isEqualTo(new BombState.Defusing(0.5, 1, 600));
    assertThat(snapshot.poison().active()).isFalse();
  }

  @Test
  void velocityAndHurtTicksFollowFromTheTickBefore() {
    capture.capture(1, state(MatchState.Phase.LIVE, Optional.empty()));
    alice.teleport(new Location(world, 2.7, 1, 2.5, 90, 10));
    alice.setHealth(14);

    var snapshot = capture.capture(2, state(MatchState.Phase.LIVE, Optional.empty()));

    var a = snapshot.require(ids.combatant(alice.getUniqueId()));
    assertThat(a.vel().x()).isCloseTo(0.2, org.assertj.core.api.Assertions.within(1e-9));
    assertThat(a.lastHurtTick()).isEqualTo(2);
    var later = capture.capture(3, state(MatchState.Phase.LIVE, Optional.empty()));
    assertThat(later.require(ids.combatant(alice.getUniqueId())).lastHurtTick()).isEqualTo(2);
  }

  @Test
  void stimuliAreMappedToMatchIdsAndStrangersDropped() {
    stimuli.fuseClicked(bob.getUniqueId(), new Location(world, 4.5, 1.5, 16.5));
    stimuli.fuseClicked(UUID.randomUUID(), new Location(world, 4.5, 1.5, 16.5));
    bob.setSprinting(true);

    var snapshot = capture.capture(10, state(MatchState.Phase.LIVE, Optional.empty()));

    assertThat(snapshot.stimuli())
        .extracting(Stimulus::kind)
        .containsExactlyInAnyOrder(Stimulus.Kind.FUSE_CLICK, Stimulus.Kind.FOOTSTEP);
    assertThat(snapshot.stimuli())
        .allMatch(
            stimulus -> stimulus.source().orElseThrow().equals(ids.combatant(bob.getUniqueId())));
    assertThat(capture.capture(11, state(MatchState.Phase.LIVE, Optional.empty())).stimuli())
        .as("footsteps only every tenth tick")
        .isEmpty();
  }

  @Test
  void poisonStartsCountingWhenItTurnsDeadly() {
    capture.capture(
        1, state(MatchState.Phase.LIVE, Optional.of(new MatchState.Poison(false, 5000))));
    var deadly = Optional.of(new MatchState.Poison(true, 0));
    capture.capture(100, state(MatchState.Phase.LIVE, deadly));

    var snapshot = capture.capture(160, state(MatchState.Phase.LIVE, deadly));

    assertThat(snapshot.poison().active()).isTrue();
    assertThat(snapshot.poison().startedTick()).isEqualTo(100);
    assertThat(snapshot.poison().intensity()).isEqualTo(60 * SnapshotCapture.POISON_RAMP_PER_TICK);
  }

  @Test
  void phasesMapAndAFighterWithoutAKitIsABrokenContract() {
    assertThat(SnapshotCapture.phase(MatchState.Phase.COUNTDOWN)).isEqualTo(MatchPhase.WAITING);
    assertThat(SnapshotCapture.phase(MatchState.Phase.RESETTING)).isEqualTo(MatchPhase.OVER);
    var broken =
        new MatchState(
            MATCH,
            MatchState.Phase.LIVE,
            Optional.of("synthetic"),
            List.of("red"),
            List.of(
                new MatchState.Fighter(
                    alice.getUniqueId(),
                    "Alice",
                    Optional.empty(),
                    Optional.of("red"),
                    Optional.empty(),
                    true)),
            List.of(),
            Optional.empty(),
            Optional.empty());

    assertThatThrownBy(() -> capture.capture(1, broken))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Alice has no kit");
    assertThat(Map.of()).isEmpty();
  }
}
