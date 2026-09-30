package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.Location;
import org.junit.jupiter.api.Test;

/**
 * The {@link Protection} port's contract, answered by the real engine over Aegis (chunks 10..11 on
 * z chunk 10), spawn (chunks -4..3, PvP off) and the wilderness (PvP on).
 */
final class ProtectionPortTest extends AegisServer {

  private Protection port() {
    return plugin.services.require(Protection.class);
  }

  private Location at(int x, int z) {
    return new Location(world, x, Y, z);
  }

  @Test
  void playersFightOnlyWherePvpIsOnForBoth() throws InterruptedException {
    // New claims have PvP on; Aegis turns it off on both of its chunks.
    for (var x : new int[] {165, 180}) {
      alice.teleport(at(x, Z));
      server.dispatchCommand(alice, "claim flag pvp false");
      awaitLine(alice, "pvp is now off here.");
    }
    var port = port();
    var aegis = at(170, Z);
    var aegisToo = at(185, Z);
    var spawn = at(8, 8);
    var wild = at(500, 500);
    var wildToo = at(510, 500);

    assertThat(port.checkHarm(alice.getUniqueId(), aegis, HarmTarget.PLAYER, aegisToo).isAllowed())
        .as("residents of a PvP-off town")
        .isFalse();
    assertThat(port.checkHarm(bob.getUniqueId(), spawn, HarmTarget.PLAYER, wild).isAllowed())
        .as("a caster in PvP-off spawn at a player in the wild")
        .isFalse();
    assertThat(port.checkHarm(bob.getUniqueId(), wild, HarmTarget.PLAYER, spawn).isAllowed())
        .as("from the wild into spawn")
        .isFalse();
    assertThat(port.checkHarm(bob.getUniqueId(), wild, HarmTarget.PLAYER, wildToo).isAllowed())
        .as("both in the wild")
        .isTrue();
  }

  @Test
  void passiveCreaturesFollowTheirLand() {
    var port = port();
    var aegis = at(170, Z);
    var wild = at(500, 500);

    assertThat(port.checkHarm(bob.getUniqueId(), wild, HarmTarget.PASSIVE, aegis).isAllowed())
        .isFalse();
    assertThat(port.checkHarm(alice.getUniqueId(), wild, HarmTarget.PASSIVE, aegis).isAllowed())
        .isTrue();
    assertThat(port.checkHarm(bob.getUniqueId(), aegis, HarmTarget.PASSIVE, wild).isAllowed())
        .isTrue();
    assertThat(port.checkHarm(bob.getUniqueId(), wild, HarmTarget.PASSIVE, at(8, 8)).isAllowed())
        .isFalse();
  }

  @Test
  void sameLandMeansTheSameOwner() {
    var port = port();

    assertThat(port.sameLand(at(165, Z), at(185, Z))).as("two chunks of Aegis").isTrue();
    assertThat(port.sameLand(at(165, Z), at(150, Z))).as("Aegis and the wild").isFalse();
    assertThat(port.sameLand(at(500, 500), at(-900, 900))).as("the wild twice").isTrue();
    assertThat(port.sameLand(at(0, 0), at(40, 40))).as("spawn twice").isTrue();
    assertThat(port.sameLand(at(0, 0), at(165, Z))).as("spawn and Aegis").isFalse();
  }

  @Test
  void theOldChecksStillAnswer() {
    var port = port();

    assertThat(port.check(bob.getUniqueId(), ProtectedAction.BUILD, at(170, Z)).isAllowed())
        .isFalse();
    assertThat(port.check(alice.getUniqueId(), ProtectedAction.BUILD, at(170, Z)).isAllowed())
        .isTrue();
  }

  @Test
  void callsOffTheMainThreadThrow() throws InterruptedException {
    var port = port();
    var thrown = new AtomicReference<Throwable>();
    var here = at(170, Z);
    var worker =
        new Thread(
            () -> {
              try {
                port.sameLand(here, here);
              } catch (IllegalStateException e) {
                thrown.set(e);
              }
            });

    worker.start();
    worker.join();

    assertThat(thrown.get()).isInstanceOf(IllegalStateException.class);
  }
}
