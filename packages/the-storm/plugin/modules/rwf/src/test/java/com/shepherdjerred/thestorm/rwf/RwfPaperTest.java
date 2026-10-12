package com.shepherdjerred.thestorm.rwf;

import static com.shepherdjerred.thestorm.rwf.RwfHarness.messages;
import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The lobby on MockBukkit: joining snapshots and clears a player into the sealed world, every way
 * out restores them exactly, the attack-speed modifier comes and goes, the fuse stays in slot 0,
 * hunger never drops, teleports are refused, and a crash's snapshot comes back on the next join.
 */
final class RwfPaperTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness track(RwfHarness harness) {
    running = harness;
    return harness;
  }

  private RwfHarness harness() {
    return requireNonNull(running);
  }

  PlayerMock loadedPlayer(String name) {
    return harness().loadedPlayer(name);
  }

  private List<Snapshot> stored() {
    return new JooqSnapshotStore(harness().database).loadAll().join();
  }

  private boolean inMatch(PlayerMock player) {
    return harness().inMatch(player);
  }

  void enter(PlayerMock player) {
    harness().enter(player);
  }

  private void assertRestored(PlayerMock player) {
    assertThat(player.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(player.getInventory().getHelmet()).isEqualTo(ItemStack.of(Material.IRON_HELMET));
    assertThat(player.getLevel()).isEqualTo(7);
    assertThat(player.getHealth()).isEqualTo(13);
    assertThat(player.getFoodLevel()).isEqualTo(15);
    assertThat(player.getPotionEffect(PotionEffectType.SPEED)).isNotNull();
    assertThat(player.getWorld()).isEqualTo(harness().overworld);
    assertThat(player.getLocation().getX()).isEqualTo(50.5);
    assertThat(player.getGameMode()).isEqualTo(GameMode.SURVIVAL);
  }

  private static boolean hasAttackSpeed(PlayerMock player) {
    var attribute = requireNonNull(player.getAttribute(Attribute.ATTACK_SPEED));
    return attribute.getModifier(new NamespacedKey("thestorm", "rwf_attack_speed")) != null;
  }

  @Test
  void enablingPastesTheMapAndSealsTheWorld() {
    var harness = track(RwfHarness.start(directory));

    assertThat(harness.sealed.isSealed("rwf")).isTrue();
    assertThat(harness.rwf.getBlockAt(8, 65, 31).getType()).isEqualTo(Material.TNT);
    assertThat(harness.rwf.getBlockAt(0, 64, 0).getType()).isEqualTo(Material.STONE_BRICKS);
    assertThat(harness.rwf.getBlockAt(31, 77, 31).getType()).isEqualTo(Material.GLASS);
    // The training yard's 16 chunks and the lobby's 4.
    assertThat(harness.chunks.held).isEqualTo(20);
    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LOBBY);
    assertThat(harness.snapshot().mapId()).contains("training-yard");
  }

  @Test
  void joiningSnapshotsAndClearsThePlayerIntoTheLobbyAndTellsThemAboutRecording() {
    var harness = track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");

    enter(alice);

    assertThat(stored())
        .singleElement()
        .satisfies(s -> assertThat(s.player()).isEqualTo(alice.getUniqueId()));
    assertThat(alice.getLevel()).isZero();
    assertThat(alice.getActivePotionEffects()).isEmpty();
    // The lobby room's spawn pad.
    assertThat(alice.getLocation().getX()).isEqualTo(143.5);
    assertThat(alice.getLocation().getY()).isEqualTo(65);
    assertThat(hasAttackSpeed(alice)).isTrue();
    assertThat(alice.getScoreboard())
        .isNotEqualTo(harness.server.getScoreboardManager().getMainScoreboard());
    assertThat(messages(alice))
        .anyMatch(m -> m.contains("Alice joined the match"))
        .anyMatch(m -> m.contains("recorded"));
  }

  @Test
  void leavingRestoresEverythingExactlyAndRemovesTheModifier() {
    var harness = track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice);
    alice.performCommand("rwf kit longbow");
    assertThat(alice.getInventory().getItem(2)).isNotNull();
    assertThat(requireNonNull(alice.getInventory().getItem(2)).getType()).isEqualTo(Material.BOW);

    alice.performCommand("rwf leave");

    assertRestored(alice);
    assertThat(hasAttackSpeed(alice)).isFalse();
    assertThat(inMatch(alice)).isFalse();
    assertThat(alice.getScoreboard())
        .isEqualTo(harness.server.getScoreboardManager().getMainScoreboard());
    assertThat(stored()).hasSize(1);
    harness.rejoinAfterSave(alice);
    harness.until(() -> stored().isEmpty());
  }

  @Test
  void disconnectingRestoresThePlayerBeforeTheServerSavesThem() {
    track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice);

    alice.disconnect();

    assertRestored(alice);
    assertThat(inMatch(alice)).isFalse();
  }

  @Test
  void aSnapshotLeftByACrashIsRestoredWhenThePlayerReturns() {
    var harness = track(RwfHarness.prepare(directory));
    var alice = harness.server.addPlayer("Alice");
    var belongings =
        new ItemStack[] {ItemStack.of(Material.EMERALD, 12), ItemStack.of(Material.BREAD, 3)};
    var snapshot =
        new Snapshot(
            alice.getUniqueId(),
            "rwf",
            new Position("world", 5.5, 70, 5.5, 0, 0),
            new Vitals(9, 11, 1, 0, "SURVIVAL"),
            new Experience(3, 0.25f, 40),
            ItemData.of(ItemStack.serializeItemsAsBytes(belongings)),
            List.of(new EffectRecord("minecraft:haste", 0, 400, false, true, true)),
            Samples.T0);
    new JooqSnapshotStore(harness.database).save(snapshot).join();
    alice.getInventory().addItem(ItemStack.of(Material.DIAMOND_SWORD));

    harness.enable(directory);
    harness.until(() -> alice.getInventory().contains(Material.EMERALD, 12));

    assertThat(alice.getInventory().contains(Material.DIAMOND_SWORD)).isFalse();
    assertThat(alice.getLevel()).isEqualTo(3);
    assertThat(alice.getLocation().getX()).isEqualTo(5.5);
    assertThat(stored()).hasSize(1);
    harness.rejoinAfterSave(alice);
    harness.until(() -> stored().isEmpty());
  }

  @Test
  void theFuseCannotBeDroppedOrMovedOutOfSlotZero() {
    var harness = track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice);
    alice.performCommand("rwf kit trooper");
    var fuse = requireNonNull(alice.getInventory().getItem(0));
    assertThat(fuse.getType()).isEqualTo(Material.BLAZE_POWDER);
    assertThat(
            fuse.getItemMeta()
                .getPersistentDataContainer()
                .has(new NamespacedKey("thestorm", "rwf_fuse"), PersistentDataType.BOOLEAN))
        .isTrue();

    var dropped = harness.rwf.dropItem(alice.getLocation(), fuse.clone());
    var drop = new PlayerDropItemEvent(alice, dropped);
    harness.server.getPluginManager().callEvent(drop);
    // MockBukkit's crafting view cannot convert slots; a view over the player's own inventory can,
    // and slot 0 of it is the fuse slot either way.
    var view = requireNonNull(alice.openInventory(alice.getInventory()));
    var click =
        new InventoryClickEvent(
            view, InventoryType.SlotType.QUICKBAR, 0, ClickType.LEFT, InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(click);
    var swordClick =
        new InventoryClickEvent(
            view, InventoryType.SlotType.QUICKBAR, 1, ClickType.LEFT, InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(swordClick);

    assertThat(drop.isCancelled()).isTrue();
    assertThat(click.isCancelled()).as("slot 0 is locked").isTrue();
    assertThat(swordClick.isCancelled()).as("other slots move freely").isFalse();
  }

  @Test
  void hungerNeverDropsForAMember() {
    var harness = track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice);
    var bob = harness.server.addPlayer("Bob");

    var starving = new FoodLevelChangeEvent(alice, 10, ItemStack.empty());
    harness.server.getPluginManager().callEvent(starving);
    var eating = new FoodLevelChangeEvent(alice, 20, ItemStack.empty());
    harness.server.getPluginManager().callEvent(eating);
    var outsider = new FoodLevelChangeEvent(bob, 10, ItemStack.empty());
    harness.server.getPluginManager().callEvent(outsider);

    assertThat(starving.isCancelled()).isTrue();
    assertThat(eating.isCancelled()).isFalse();
    assertThat(outsider.isCancelled()).isFalse();
  }

  @Test
  void membersCannotTeleportOutAndOutsidersCannotTeleportIn() {
    var harness = track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice);
    var bob = harness.server.addPlayer("Bob");
    bob.teleport(new Location(harness.overworld, 0, 70, 0));

    var out =
        new PlayerTeleportEvent(
            alice, alice.getLocation(), new Location(harness.overworld, 0, 70, 0));
    harness.server.getPluginManager().callEvent(out);
    var within =
        new PlayerTeleportEvent(alice, alice.getLocation(), new Location(harness.rwf, 10, 66, 10));
    harness.server.getPluginManager().callEvent(within);
    var in = new PlayerTeleportEvent(bob, bob.getLocation(), new Location(harness.rwf, 10, 66, 10));
    harness.server.getPluginManager().callEvent(in);
    bob.setGameMode(GameMode.CREATIVE);
    var staff =
        new PlayerTeleportEvent(bob, bob.getLocation(), new Location(harness.rwf, 10, 66, 10));
    harness.server.getPluginManager().callEvent(staff);

    assertThat(out.isCancelled()).isTrue();
    assertThat(within.isCancelled()).isFalse();
    assertThat(in.isCancelled()).isTrue();
    assertThat(staff.isCancelled()).isFalse();
  }

  @Test
  void transitionsReachSubscribersAfterTheirEffects() {
    var harness = track(RwfHarness.start(directory));
    var seen = new ArrayList<MatchNotification>();
    var subscription = harness.events().subscribe(seen::add);
    var alice = loadedPlayer("Alice");

    enter(alice);

    assertThat(seen)
        .anyMatch(
            n ->
                n.event() instanceof com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.Join
                    && n.after().combatants().size() == 1);
    subscription.close();
    alice.performCommand("rwf leave");
    assertThat(seen)
        .noneMatch(
            n ->
                n.event() instanceof com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.Leave);
  }

  @Test
  void theAttackSpeedModifierUsesTheRulesValue() {
    track(RwfHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice);

    var modifier =
        requireNonNull(
            requireNonNull(alice.getAttribute(Attribute.ATTACK_SPEED))
                .getModifier(new NamespacedKey("thestorm", "rwf_attack_speed")));

    assertThat(modifier.getAmount()).isEqualTo(CombatRules.ATTACK_SPEED_MODIFIER);
    assertThat(Duration.ofMillis(50).toMillis()).isEqualTo(50);
  }
}
