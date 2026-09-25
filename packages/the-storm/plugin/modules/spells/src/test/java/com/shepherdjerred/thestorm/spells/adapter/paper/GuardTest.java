package com.shepherdjerred.thestorm.spells.adapter.paper;

import static com.shepherdjerred.thestorm.spells.adapter.paper.FakeProtection.AEGIS;
import static com.shepherdjerred.thestorm.spells.adapter.paper.FakeProtection.NO_PVP;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Zombie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Protection decisions with a fake land-protection port (Aegis's claim is x >= 0). */
final class GuardTest {

  private final Harness harness = new Harness();
  private final FakeProtection protection = new FakeProtection();
  private final Guard guard = new Guard(protection);

  @AfterEach
  void tearDown() {
    harness.close();
  }

  private Location at(double x) {
    return new Location(harness.world, x, 64, 0);
  }

  @Test
  void blocksInsideAForeignClaimAreScreenedOut() {
    var caster = harness.server.addPlayer();
    List<Block> blocks =
        List.of(
            harness.world.getBlockAt(-2, 64, 0),
            harness.world.getBlockAt(1, 64, 0),
            harness.world.getBlockAt(-1, 64, 0));

    var screened = guard.blocks(caster, ProtectedAction.BUILD, blocks);

    assertThat(screened.allowed()).containsExactly(blocks.get(0), blocks.get(2));
    assertThat(screened.firstDenial()).contains(AEGIS);
    assertThat(protection.actions).containsOnly(ProtectedAction.BUILD);
  }

  @Test
  void aResidentMayBuildInTheirOwnClaim() {
    var caster = harness.server.addPlayer();
    protection.residents.add(caster.getUniqueId());

    var screened =
        guard.blocks(caster, ProtectedAction.BUILD, List.of(harness.world.getBlockAt(5, 64, 0)));

    assertThat(screened.allowed()).hasSize(1);
  }

  @Test
  void harmingAPlayerNeedsPvpOnBothLands() {
    var caster = harness.server.addPlayer();
    var victim = harness.server.addPlayer();
    caster.teleport(at(-10));

    victim.teleport(at(4));
    assertThat(guard.harmDenial(caster, victim)).contains(NO_PVP);

    victim.teleport(at(-4));
    assertThat(guard.harmDenial(caster, victim)).isEmpty();

    // The victim stands in the wilderness, but the caster fires from inside the PvP-off claim.
    caster.teleport(at(10));
    assertThat(guard.harmDenial(caster, victim)).contains(NO_PVP);
    assertThat(protection.harms).containsOnly(HarmTarget.PLAYER);
  }

  @Test
  void residentsCannotHarmEachOtherInAPvpOffClaim() {
    var caster = harness.server.addPlayer();
    var victim = harness.server.addPlayer();
    protection.residents.add(caster.getUniqueId());
    protection.residents.add(victim.getUniqueId());
    caster.teleport(at(3));
    victim.teleport(at(5));

    assertThat(guard.harmDenial(caster, victim)).contains(NO_PVP);
  }

  @Test
  void animalsAreAskedAsPassiveCreaturesOfTheirLand() {
    var caster = harness.server.addPlayer();
    var cow = harness.world.spawn(at(3), Cow.class);

    assertThat(guard.harmDenial(caster, cow)).contains(AEGIS);
    assertThat(protection.harms).containsExactly(HarmTarget.PASSIVE);

    protection.residents.add(caster.getUniqueId());
    assertThat(guard.harmDenial(caster, cow)).isEmpty();
  }

  @Test
  void monstersAreFairGameExceptOnLandTheCasterMayNotBuildOn() {
    var caster = harness.server.addPlayer();
    var wild = harness.world.spawn(at(-3), Zombie.class);
    var farmed = harness.world.spawn(at(3), Zombie.class);

    var screened = guard.creatures(caster, List.of(wild, farmed));

    assertThat(screened.allowed()).containsExactly(wild);
    assertThat(screened.firstDenial()).contains(AEGIS);
    assertThat(protection.harms).isEmpty();
    assertThat(protection.actions).containsOnly(ProtectedAction.BUILD);
  }

  @Test
  void teleportArrivalsAskForTeleportInto() {
    var caster = harness.server.addPlayer();

    assertThat(guard.denial(caster, ProtectedAction.TELEPORT_INTO, at(10))).contains(AEGIS);
    assertThat(guard.denial(caster, ProtectedAction.TELEPORT_INTO, at(-10))).isEmpty();
  }
}
