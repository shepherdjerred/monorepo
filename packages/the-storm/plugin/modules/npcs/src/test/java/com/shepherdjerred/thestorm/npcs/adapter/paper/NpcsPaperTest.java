package com.shepherdjerred.thestorm.npcs.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.npcs.app.NpcInteractEvent;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Pose;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.PluginDescriptionFile;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The Paper side on MockBukkit: Mannequins are reconciled with content, clicks open dialogue, and
 * {@code /npc} works. Skins, dialogs, markers, navigators and chunk tickets use Paper APIs
 * MockBukkit lacks; they are covered by the real-server tests.
 */
final class NpcsPaperTest {

  private static final NamespacedKey NPC = new NamespacedKey("thestorm", "npc");

  @TempDir Path directory;

  private ServerMock server;
  private WorldMock world;
  private @Nullable NpcsTestPlugin loaded;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    NpcsTestPlugin.directory = directory;
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private String worldKey() {
    return world.getKey().asString();
  }

  private String npc(String id, String name, double x, String dialogue) {
    return """
          %s:
            name: "%s"
            description: Test
            skin: none
            home: { world: "%s", x: %s, y: 64.0, z: 0.5, yaw: 0.0, pitch: 0.0 }
            pose: sneaking
            roles: [test]
            schedule: none
            dialogue: %s
            trainer: none
        """
        .formatted(id, name, worldKey(), x, dialogue);
  }

  private void writeContent(String npcs) throws IOException {
    var folder = Files.createDirectories(directory.resolve("npcs"));
    Files.writeString(
        folder.resolve("test.yml"),
        """
        places: {}
        skins: {}
        schedules: {}
        dialogues:
          hello:
            title: Nat
            start: greet
            nodes:
              greet:
                text: "Welcome in."
                next: none
                options:
                  - { label: "Bye", then: close }
        npcs:
        """
            + npcs);
  }

  private void enable() {
    loaded =
        MockBukkit.loadWith(
            NpcsTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", NpcsTestPlugin.class.getName()));
  }

  private NpcsTestPlugin plugin() {
    return Objects.requireNonNull(loaded, "enable() first");
  }

  /** Takes over clicks, as another module would. */
  static final class Takeover implements Listener {

    final List<String> seen = new ArrayList<>();

    @EventHandler
    public void onNpc(NpcInteractEvent event) {
      seen.add(event.npc().id());
      event.setCancelled(true);
    }
  }

  private List<Mannequin> mannequins() {
    return new ArrayList<>(world.getEntitiesByClass(Mannequin.class));
  }

  private Mannequin mannequin(String id) {
    return mannequins().stream()
        .filter(m -> id.equals(m.getPersistentDataContainer().get(NPC, PersistentDataType.STRING)))
        .findFirst()
        .orElseThrow();
  }

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  private static List<String> messages(PlayerMock player) {
    var seen = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      seen.add(plain(message));
    }
    return seen;
  }

  private Mannequin spawnTagged(String id, double x) {
    return world.spawn(
        new Location(world, x, 64, 0.5),
        Mannequin.class,
        m -> m.getPersistentDataContainer().set(NPC, PersistentDataType.STRING, id));
  }

  @Test
  void enableSpawnsAndDressesEveryNpc() throws IOException {
    writeContent(
        npc("nat", "Nat · Tavern", 0.5, "hello") + npc("stan", "Stan · Shop", 3.5, "none"));
    enable();
    assertThat(mannequins()).hasSize(2);
    var nat = mannequin("nat");
    assertThat(plain(Objects.requireNonNull(nat.customName()))).isEqualTo("Nat · Tavern");
    assertThat(nat.isCustomNameVisible()).isTrue();
    assertThat(plain(Objects.requireNonNull(nat.getDescription()))).isEqualTo("Test");
    assertThat(nat.isImmovable()).isTrue();
    assertThat(nat.isInvulnerable()).isTrue();
    assertThat(nat.isPersistent()).isTrue();
    assertThat(nat.getPose()).isEqualTo(Pose.SNEAKING);
    assertThat(nat.getLocation().getX()).isEqualTo(0.5);
    assertThat(plugin().tickets).isNotEmpty();
  }

  @Test
  void enableRemovesOrphansAndDuplicatesAndKeepsTheRest() throws IOException {
    var orphan = spawnTagged("ghost", 10.5);
    var first = spawnTagged("nat", 0.5);
    var second = spawnTagged("nat", 1.5);
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    assertThat(orphan.isValid()).isFalse();
    assertThat(mannequins()).hasSize(1);
    var kept = mannequins().getFirst();
    assertThat(kept.getUniqueId()).isIn(first.getUniqueId(), second.getUniqueId());
    // The kept copy was set up from its definition.
    assertThat(plain(Objects.requireNonNull(kept.customName()))).isEqualTo("Nat");
  }

  @Test
  void rightClickingAnNpcOpensItsDialogue() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var player = server.addPlayer("Alice");
    var event = new PlayerInteractEntityEvent(player, mannequin("nat"), EquipmentSlot.HAND);
    server.getPluginManager().callEvent(event);
    assertThat(event.isCancelled()).isTrue();
    assertThat(plugin().shown)
        .singleElement()
        .satisfies(
            shown -> {
              assertThat(shown.player()).isSameAs(player);
              assertThat(shown.screen().body()).isEqualTo("Welcome in.");
            });
    // Pressing Bye closes the dialog.
    plugin().shown.getFirst().onClick().accept(0);
    assertThat(plugin().closed).containsExactly(player);
  }

  @Test
  void theOffHandClickIsIgnored() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var player = server.addPlayer("Alice");
    var event = new PlayerInteractEntityEvent(player, mannequin("nat"), EquipmentSlot.OFF_HAND);
    server.getPluginManager().callEvent(event);
    assertThat(event.isCancelled()).isTrue();
    assertThat(plugin().shown).isEmpty();
  }

  @Test
  void anotherModuleCanTakeOverTheClick() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var takeover = new Takeover();
    server.getPluginManager().registerEvents(takeover, plugin());
    var player = server.addPlayer("Alice");
    server
        .getPluginManager()
        .callEvent(new PlayerInteractEntityEvent(player, mannequin("nat"), EquipmentSlot.HAND));
    assertThat(takeover.seen).containsExactly("nat");
    assertThat(plugin().shown).isEmpty();
  }

  @Test
  void clickingOtherEntitiesDoesNothing() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var player = server.addPlayer("Alice");
    var stranger = world.spawn(new Location(world, 5, 64, 5), Mannequin.class);
    var event = new PlayerInteractEntityEvent(player, stranger, EquipmentSlot.HAND);
    server.getPluginManager().callEvent(event);
    assertThat(event.isCancelled()).isFalse();
    assertThat(plugin().shown).isEmpty();
  }

  @Test
  void npcListShowsEveryNpc() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello") + npc("stan", "Stan", 3.5, "none"));
    enable();
    var admin = server.addPlayer("Admin");
    admin.setOp(true);
    server.dispatchCommand(admin, "npc list");
    var lines = messages(admin);
    assertThat(lines.getFirst()).isEqualTo("[NPCs]: 2 NPCs:");
    assertThat(lines)
        .anyMatch(line -> line.startsWith(" nat: Nat (") && line.contains("here [test]"));
    assertThat(lines).anyMatch(line -> line.startsWith(" stan: Stan ("));
  }

  @Test
  void npcHerePrintsAPasteableHome() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var admin = server.addPlayer("Admin");
    admin.setOp(true);
    admin.teleport(new Location(world, 12.25, 70, -4.5, 90, 0));
    server.dispatchCommand(admin, "npc here stan");
    assertThat(messages(admin))
        .contains(
            """
            # npcs.stan
            home:
              world: %s
              x: 12.25
              y: 70.00
              z: -4.50
              yaw: 90.0
              pitch: 0.0\
            """
                .formatted(worldKey()));
  }

  @Test
  void npcCommandsNeedThePermission() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var player = server.addPlayer("Alice");
    server.dispatchCommand(player, "npc list");
    assertThat(messages(player)).noneMatch(line -> line.contains("NPCs:"));
  }

  @Test
  void reloadAppliesChangedContent() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello") + npc("stan", "Stan", 3.5, "none"));
    enable();
    var natBefore = mannequin("nat").getUniqueId();
    var stanBefore = mannequin("stan");
    writeContent(
        npc("nat", "Nat the Innkeeper", 0.5, "hello") + npc("thomas", "Thomas", 6.5, "none"));
    var admin = server.addPlayer("Admin");
    admin.setOp(true);
    server.dispatchCommand(admin, "npc reload");
    server.getScheduler().performTicks(2);
    assertThat(messages(admin))
        .contains("[NPCs]: Reloaded 2 NPCs: 1 spawned, 1 updated, 0 unchanged, 1 removed.");
    var nat = mannequin("nat");
    assertThat(nat.getUniqueId()).isEqualTo(natBefore);
    assertThat(plain(Objects.requireNonNull(nat.customName()))).isEqualTo("Nat the Innkeeper");
    assertThat(stanBefore.isValid()).isFalse();
    assertThat(mannequin("thomas").getLocation().getX()).isEqualTo(6.5);
  }

  @Test
  void reloadKeepsTheOldNpcsWhenContentIsBroken() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    writeContent(npc("nat", "Nat", 0.5, "missing-dialogue"));
    var admin = server.addPlayer("Admin");
    admin.setOp(true);
    server.dispatchCommand(admin, "npc reload");
    server.getScheduler().performTicks(2);
    var lines = messages(admin);
    assertThat(lines).contains("[NPCs]: Content has 1 problems; kept the old NPCs:");
    assertThat(lines).anyMatch(line -> line.contains("dialogue missing-dialogue is not defined"));
    assertThat(mannequins()).hasSize(1);
  }

  @Test
  void aRestingNpcTurnsToLookAtANearbyPlayer() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var player = server.addPlayer("Alice");
    // Stand three blocks west (-X) of Nat, who faces south (yaw 0).
    player.teleport(new Location(world, -2.5, 64, 0.5));
    server.getScheduler().performTicks(3);
    assertThat(mannequin("nat").getYaw()).isCloseTo(90f, org.assertj.core.data.Offset.offset(1f));
    assertThat(mannequin("nat").getPose()).isEqualTo(Pose.SNEAKING);
  }

  @Test
  void npcsWithoutPlayersNearbyStayPut() throws IOException {
    writeContent(npc("nat", "Nat", 0.5, "hello"));
    enable();
    var player = server.addPlayer("Alice");
    player.teleport(new Location(world, 500, 64, 500));
    server.getScheduler().performTicks(3);
    assertThat(mannequin("nat").getYaw()).isZero();
  }
}
