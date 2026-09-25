package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Zombie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Protection decisions with a fake land-protection port: everything east of x=0 is Aegis's claim,
 * where outsiders may not build, hurt animals or players, or teleport in.
 */
final class GuardTest {

  private static final Component AEGIS = Component.text("This land belongs to Aegis.");

  private final Harness harness = new Harness();
  private final FakeProtection protection = new FakeProtection();
  private final Guard guard = new Guard(protection);

  @AfterEach
  void tearDown() {
    harness.close();
  }

  /** Denies everything at x >= 0 except to the claim's owner; records every question. */
  static final class FakeProtection implements Protection {
    final List<ProtectedAction> asked = new ArrayList<>();
    UUID owner = new UUID(9, 9);

    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      asked.add(action);
      if (location.getX() >= 0 && !player.equals(owner)) {
        return new Decision.Denied(AEGIS);
      }
      return Decision.allowed();
    }
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
    assertThat(protection.asked).containsOnly(ProtectedAction.BUILD);
  }

  @Test
  void theClaimOwnerMayCastInTheirOwnClaim() {
    var caster = harness.server.addPlayer();
    protection.owner = caster.getUniqueId();

    var screened =
        guard.blocks(caster, ProtectedAction.BUILD, List.of(harness.world.getBlockAt(5, 64, 0)));

    assertThat(screened.allowed()).hasSize(1);
    assertThat(screened.firstDenial()).isEmpty();
  }

  @Test
  void aPlayerInANoPvpClaimCannotBeHarmed() {
    var caster = harness.server.addPlayer();
    var victim = harness.server.addPlayer();
    victim.teleport(at(4));

    assertThat(guard.harmDenial(caster, victim)).contains(AEGIS);
    assertThat(protection.asked).containsExactly(ProtectedAction.DAMAGE_ENTITY);

    victim.teleport(at(-4));
    assertThat(guard.harmDenial(caster, victim)).isEmpty();
  }

  @Test
  void animalsInAClaimAreProtectedButMonstersAreFairGame() {
    var caster = harness.server.addPlayer();
    var cow = harness.world.spawn(at(3), Cow.class);
    var zombie = harness.world.spawn(at(3), Zombie.class);

    var screened = guard.creatures(caster, List.of(cow, zombie));

    assertThat(screened.allowed()).containsExactly(zombie);
    assertThat(screened.firstDenial()).contains(AEGIS);
  }

  @Test
  void teleportArrivalsAskForTeleportInto() {
    var caster = harness.server.addPlayer();

    assertThat(guard.denial(caster, ProtectedAction.TELEPORT_INTO, at(10))).contains(AEGIS);
    assertThat(guard.denial(caster, ProtectedAction.TELEPORT_INTO, at(-10))).isEmpty();
    assertThat(protection.asked).containsOnly(ProtectedAction.TELEPORT_INTO);
  }
}
