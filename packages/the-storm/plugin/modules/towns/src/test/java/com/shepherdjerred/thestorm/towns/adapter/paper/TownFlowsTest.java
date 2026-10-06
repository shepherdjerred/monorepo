package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.tracks.app.Track;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.junit.jupiter.api.Test;

/**
 * The town commands end to end on MockBukkit: membership, ranks, handovers, claim trust, the
 * treasury, personal PvP and the arena's spawn and creaking-heart rules. Alice owns Aegis.
 */
final class TownFlowsTest extends AegisServer {

  private void run(org.mockbukkit.mockbukkit.entity.PlayerMock player, String command) {
    assertThat(server.dispatchCommand(player, command)).isTrue();
  }

  private void bobJoins() throws InterruptedException {
    run(alice, "town invite Bob");
    awaitLine(bob, "Alice invited you to Aegis.");
    run(bob, "town accept Aegis");
    awaitLine(bob, "You joined Aegis.");
  }

  @Test
  void anInvitedPlayerJoinsBuildsAndCanBeKicked() throws InterruptedException {
    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isFalse();

    bobJoins();
    awaitLine(alice, "Bob joined the town.");
    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isTrue();

    run(alice, "town kick Bob");
    awaitLine(alice, "Bob is no longer a member.");
    awaitLine(bob, "You were removed from your town by Alice.");
    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isFalse();
  }

  @Test
  void anUninvitedPlayerCannotJoinAndMembersCannotInvite() throws InterruptedException {
    run(bob, "town accept Aegis");
    awaitLine(bob, "You have no invitation from Aegis, or it has expired.");

    bobJoins();
    run(bob, "town invite Alice");
    awaitLine(bob, "Only a town's owner or assistants invite and kick; you are a member.");
  }

  @Test
  void aDeclinedInvitationIsGone() throws InterruptedException {
    run(alice, "town invite Bob");
    run(bob, "town deny Aegis");
    awaitLine(bob, "You turned down Aegis.");
    run(bob, "town accept Aegis");
    awaitLine(bob, "You have no invitation from Aegis");
  }

  @Test
  void theOwnerRanksAndHandsTheTownOver() throws InterruptedException {
    bobJoins();
    plugin.governor.put(bob.getUniqueId(), 1);
    run(alice, "town promote Bob");
    awaitLine(alice, "Bob is now an assistant.");
    run(alice, "town demote Bob");
    awaitLine(alice, "Bob is now a member.");

    run(alice, "town transfer Bob");
    awaitLine(alice, "type /town transfer confirm within 1 minute");
    run(alice, "town transfer confirm");
    awaitLine(alice, "You handed Aegis over. You are now an assistant.");
    awaitLine(bob, "Alice handed Aegis to you.");

    run(alice, "town leave");
    awaitLine(alice, "You left Aegis.");
    run(bob, "town leave");
    awaitLine(bob, "Owners cannot leave.");
  }

  @Test
  void infoAndListDescribeTowns() throws InterruptedException {
    bobJoins();
    run(alice, "town info");
    assertThat(awaitLine(alice, "Land: 2 of 24 chunks (owner's Governor level 1)."))
        .anyMatch(line -> line.equals("[Towns]: Aegis: owner Alice; member Bob"));
    run(bob, "town list");
    awaitLine(bob, "Aegis [PLAYER] — 2 members, 2 claims, 0 permanently protected chunks");
    run(bob, "town info Test Heritage Spawn");
    awaitLine(bob, "Test Heritage Spawn [SERVER]");
  }

  @Test
  void theOwnersGovernorLevelRaisesTheLimit() throws InterruptedException {
    plugin.governor.put(alice.getUniqueId(), 3);
    run(alice, "town info");
    awaitLine(alice, "Land: 2 of 48 chunks (owner's Governor level 3).");
  }

  @Test
  void aTownCanBeRenamed() throws InterruptedException {
    run(alice, "town rename Arcadia");
    awaitLine(alice, "Your town is now called Arcadia.");
    alice.teleport(new Location(world, 165, Y, Z));
    run(alice, "claim info");
    awaitLine(alice, "This chunk belongs to Arcadia.");
  }

  @Test
  void claimTrustOpensOneChunkToAnOutsider() throws InterruptedException {
    alice.teleport(new Location(world, 165, Y, Z));
    run(alice, "claim trust Bob");
    awaitLine(alice, "Bob may now build, open containers and use switches on this chunk.");

    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isTrue();
    assertThat(breakAllowed(bob, block(180, Y, Z))).isFalse();
    var cow = world.spawnEntity(new Location(world, 165, Y, Z), EntityType.COW);
    assertThat(hitAllowed(bob, cow)).isFalse();

    run(alice, "claim untrust Bob");
    awaitLine(alice, "Bob is no longer trusted on this chunk.");
    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isFalse();
  }

  @Test
  void theTreasuryTakesDepositsAndGivesWithdrawals() throws InterruptedException {
    var alices = new AccountId.Player(alice.getUniqueId());
    plugin.wallets.give(alices, 1_000);

    run(alice, "town deposit 300");
    awaitLine(alice, "You paid 300 crystals into your town's treasury.");
    run(alice, "town balance");
    awaitLine(alice, "Your town's treasury holds 300 crystals.");
    run(alice, "town withdraw 100");
    awaitLine(alice, "You took 100 crystals from your town's treasury.");
    run(alice, "town withdraw 1000");
    awaitLine(alice, "There are only 200 crystals to pay with.");

    bobJoins();
    run(bob, "town withdraw 1");
    awaitLine(bob, "Only a town's owner or assistants take money out; members pay in.");

    run(alice, "town delete Aegis");
    awaitLine(alice, "Its treasury is yours.");
    assertThat(plugin.wallets.balanceOf(alices)).isEqualTo(1_000);
  }

  @Test
  void aPlayerWithPvpOffNeitherHitsNorIsHit() throws InterruptedException {
    alice.teleport(new Location(world, WILD_X - 5, Y, Z));
    bob.teleport(new Location(world, WILD_X - 6, Y, Z));
    run(bob, "pvp off");
    awaitLine(bob, "Your PvP is off");
    assertThat(hitAllowed(alice, bob)).isFalse();
    assertThat(hitAllowed(bob, alice)).isFalse();

    var protection = plugin.services.require(Protection.class);
    assertThat(
            protection.checkHarm(
                alice.getUniqueId(), alice.getLocation(), HarmTarget.PLAYER, bob.getLocation()))
        .isInstanceOf(Decision.Denied.class);

    run(bob, "pvp on");
    awaitLine(bob, "You changed your PvP recently; you can change it again in 7 days.");
    run(bob, "pvp status");
    awaitLine(bob, "Your PvP is off. You can change it again in 7 days.");
  }

  @Test
  void foundingNeedsGovernorOne() throws InterruptedException {
    run(bob, "town create Bastion");
    awaitLine(bob, "Founding a town takes Governor I.");
    bob.addAttachment(plugin, Track.GOVERNOR.permission(1), true);
    run(bob, "town create Bastion");
    awaitLine(bob, "Founded Bastion");
  }

  @Test
  void theArenaLetsInOnlyItsOwnMobs() {
    var zombie = world.spawnEntity(new Location(world, WILD_X - 5, Y, Z), EntityType.ZOMBIE);
    zombie.teleport(new Location(world, 540, Y, 540));

    var custom =
        call(
            new CreatureSpawnEvent(
                (org.bukkit.entity.LivingEntity) zombie, CreatureSpawnEvent.SpawnReason.CUSTOM));
    var natural =
        call(
            new CreatureSpawnEvent(
                (org.bukkit.entity.LivingEntity) zombie, CreatureSpawnEvent.SpawnReason.NATURAL));

    assertThat(custom.isCancelled()).isFalse();
    assertThat(natural.isCancelled()).isTrue();
  }

  @Test
  void playersBreakTheCreakingHeartInTheArenaButNothingElse() {
    var heart = block(540, Y, 540);
    heart.setType(Material.CREAKING_HEART);
    var wall = block(541, Y, 540);
    wall.setType(Material.STONE);

    assertThat(call(new BlockBreakEvent(heart, bob)).isCancelled()).isFalse();
    assertThat(call(new BlockBreakEvent(wall, bob)).isCancelled()).isTrue();
  }
}
