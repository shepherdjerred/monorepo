package com.shepherdjerred.thestorm.npcs.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.npcs.domain.brain.Intent;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.movement.Walker;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.EntityType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class GuardThreatsTest {

  private final ServerMock server = MockBukkit.mock();
  private final WorldMock world = server.addSimpleWorld("world");
  private final Location feet = new Location(world, 0.5, 64, 0.5);
  private final NpcsConfig.Guard guard = new NpcsConfig.Guard(12, 16, 2.5, 4, 20);

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void slimeIsAHostileEvenThoughItIsNotAMonster() {
    var cow = world.spawnEntity(feet.clone().add(1, 0, 0), EntityType.COW);
    var slime = world.spawnEntity(feet.clone().add(2, 0, 0), EntityType.SLIME);

    assertThat(
            GuardThreats.nearest(
                List.of(cow, slime), new GuardThreats.Search(feet, feet, guard), enemy -> true))
        .contains((Enemy) slime);
  }

  @Test
  void hostileInsideTheQueryBoxButOutsideTheDetectionCircleIsIgnored() {
    var zombie = world.spawnEntity(feet.clone().add(11, 0, 11), EntityType.ZOMBIE);

    assertThat(
            GuardThreats.nearest(
                List.of(zombie), new GuardThreats.Search(feet, feet, guard), enemy -> true))
        .isEmpty();
  }

  @Test
  void aNearbyThreatPreemptsConversationAndRestingPatrol() {
    var player = server.addPlayer();
    var slime = (Enemy) world.spawnEntity(feet.clone().add(5, 0, 0), EntityType.SLIME);
    var spot = new Spot(world.getKey().asString(), new Vec3(0.5, 64, 0.5), Rotation.SOUTH);
    var resting =
        new Walker(
            new Intent.Stand(spot, NpcPose.STANDING), 0, new Walker.Phase.Resting(Long.MAX_VALUE));
    var pursuing = new Walker(new Intent.Pursue(spot), 0, new Walker.Phase.Resting(Long.MAX_VALUE));

    assertThat(NpcWorld.shouldAttend(Optional.of(player), Optional.of(slime))).isFalse();
    assertThat(NpcWorld.shouldReconsider(resting, false, true)).isTrue();
    assertThat(NpcWorld.shouldReconsider(pursuing, false, true)).isFalse();
    assertThat(NpcWorld.shouldAttend(Optional.of(player), Optional.empty())).isTrue();
  }
}
