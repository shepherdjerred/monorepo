package com.shepherdjerred.thestorm.quests.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.PluginDescriptionFile;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.simulate.entity.PlayerSimulation;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The Paper side on MockBukkit: players load their quests on join, NPC dialogue and actions accept
 * and hand in, listeners turn kills, mining and movement into progress with party credit, markers
 * follow, and {@code /quests} works. Dialogs and the scoreboard sidebar use Paper APIs MockBukkit
 * lacks; they are covered by the real-server cases in E2E-CASES.md.
 */
final class QuestsPaperTest {

  @TempDir Path directory;

  private ServerMock server;
  private WorldMock world;
  private @Nullable QuestsTestPlugin loaded;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    QuestsTestPlugin.directory = directory;
    loaded =
        MockBukkit.loadWith(
            QuestsTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", QuestsTestPlugin.class.getName()));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private QuestsTestPlugin plugin() {
    return Objects.requireNonNull(loaded, "plugin");
  }

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  /** Ticks until {@code condition} holds (database work completes off the main thread). */
  private void await(String what, java.util.function.BooleanSupplier condition)
      throws InterruptedException {
    for (var attempt = 0; attempt < 400; attempt++) {
      server.getScheduler().performOneTick();
      if (condition.getAsBoolean()) {
        return;
      }
      Thread.sleep(5);
    }
    fail("never: %s", what);
  }

  private PlayerMock join(String name) throws InterruptedException {
    var player = server.addPlayer(name);
    player.teleport(new Location(world, 0, 64, 0));
    await(name + " loaded", () -> plugin().service().state(player.getUniqueId()).isPresent());
    return player;
  }

  private PlayerQuests state(PlayerMock player) {
    return plugin().service().state(player.getUniqueId()).orElseThrow();
  }

  private List<String> messages(PlayerMock player) {
    var lines = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      lines.add(plain(message));
    }
    return lines;
  }

  private void clickAction(PlayerMock player, String npc, Predicate<String> action) {
    var ref = new NpcRef(npc, npc, Set.of(), Optional.empty());
    var graph = plugin().dialogues.provided(player, ref).orElseThrow();
    assertThat(graph.problems()).isEmpty();
    var id =
        graph.nodes().values().stream()
            .flatMap(node -> node.options().stream())
            .map(option -> option.effect())
            .filter(OptionEffect.RunAction.class::isInstance)
            .map(effect -> ((OptionEffect.RunAction) effect).action())
            .filter(action)
            .findFirst()
            .orElseThrow();
    plugin().actions.find(id).orElseThrow().run(player, ref);
  }

  @Test
  void acceptingAndHandingInThroughNpcs() throws InterruptedException {
    var alice = join("alice");
    assertThat(plugin().markers.get(alice.getUniqueId()))
        .containsEntry("thomas", QuestMarker.AVAILABLE)
        .containsEntry("captain", QuestMarker.AVAILABLE);
    clickAction(alice, "thomas", id -> id.equals("quests.accept.smith"));
    assertThat(state(alice).active("smith")).isPresent();
    assertThat(plugin().sidebars.get(alice.getUniqueId())).isPresent();
    alice.getInventory().addItem(new ItemStack(Material.IRON_INGOT, 5));
    plugin().service().tick();
    assertThat(plugin().markers.get(alice.getUniqueId()))
        .containsEntry("thomas", QuestMarker.TURN_IN);
    clickAction(alice, "thomas", id -> id.equals("quests.turnin.smith"));
    assertThat(state(alice).completion("smith")).isPresent();
    assertThat(
            alice.getInventory().all(Material.IRON_INGOT).values().stream()
                .mapToInt(ItemStack::getAmount)
                .sum())
        .isEqualTo(3);
    assertThat(messages(alice))
        .contains("[Quests]: Handed over 2 Iron Ingot.", "[Quests]: Quest complete: Quest smith");
    assertThat(plugin().paid).containsExactly("10 quest:smith");
    assertThat(plugin().markers.get(alice.getUniqueId())).containsEntry("thomas", QuestMarker.NONE);
    // The completed quest is saved.
    await("saved", () -> plugin().service().top().join().size() == 1);
  }

  @Test
  void killsCountAndAreSharedWithNearbyPartners() throws InterruptedException {
    var alice = join("alice");
    var bob = join("bob");
    bob.teleport(new Location(world, 3, 64, 0));
    var service = plugin().service();
    service.accept(alice.getUniqueId(), "hunt", "captain");
    service.accept(bob.getUniqueId(), "hunt", "captain");
    var zombie = (LivingEntity) world.spawnEntity(new Location(world, 1, 64, 0), EntityType.ZOMBIE);
    zombie.setKiller(alice);
    zombie.setHealth(0);
    assertThat(state(alice).active("hunt").orElseThrow().progress()).containsExactly(1);
    assertThat(state(bob).active("hunt").orElseThrow().progress()).containsExactly(1);
  }

  @Test
  void placedBlocksDoNotCountAsMined() throws InterruptedException {
    var alice = join("alice");
    plugin().service().accept(alice.getUniqueId(), "dig", "captain");
    var at = new Location(world, 5, 64, 5);
    new PlayerSimulation(alice).simulateBlockPlace(Material.STONE, at);
    new PlayerSimulation(alice).simulateBlockBreak(at.getBlock());
    assertThat(state(alice).active("dig")).isPresent();
    var natural = new Location(world, 6, 64, 5);
    natural.getBlock().setType(Material.STONE);
    new PlayerSimulation(alice).simulateBlockBreak(natural.getBlock());
    assertThat(state(alice).completion("dig")).isPresent();
  }

  @Test
  void walkingIntoARegionCountsThenReporting() throws InterruptedException {
    assertThat(world.getKey().asString()).isEqualTo("minecraft:overworld");
    var alice = join("alice");
    plugin().service().accept(alice.getUniqueId(), "trip", "captain");
    new PlayerSimulation(alice).simulatePlayerMove(new Location(world, 50, 64, 50));
    assertThat(state(alice).active("trip").orElseThrow().progress()).containsExactly(0, 0);
    new PlayerSimulation(alice).simulatePlayerMove(new Location(world, 101, 64, 100));
    assertThat(state(alice).active("trip").orElseThrow().progress()).containsExactly(1, 0);
    clickAction(alice, "captain", id -> id.equals("quests.turnin.trip"));
    assertThat(state(alice).completion("trip")).isPresent();
  }

  @Test
  void commandsShowTrackAndAbandon() throws InterruptedException {
    var alice = join("alice");
    var service = plugin().service();
    service.accept(alice.getUniqueId(), "hunt", "captain");
    service.accept(alice.getUniqueId(), "dig", "captain");
    messages(alice);
    server.dispatchCommand(alice, "quests");
    assertThat(plugin().journals)
        .singleElement()
        .satisfies(view -> assertThat(view.active()).containsExactly("dig", "hunt"));
    server.dispatchCommand(alice, "quests track dig");
    assertThat(state(alice).tracked()).contains("dig");
    server.dispatchCommand(alice, "quests abandon dig");
    assertThat(state(alice).active("dig")).isEmpty();
    assertThat(messages(alice))
        .contains("[Quests]: Tracking Quest dig.", "[Quests]: Quest dropped: Quest dig");
  }

  @Test
  void adminCommandsNeedThePermission() throws InterruptedException {
    var alice = join("alice");
    server.dispatchCommand(alice, "quests admin complete alice hunt");
    assertThat(state(alice).completion("hunt")).isEmpty();
    alice.setOp(true);
    server.dispatchCommand(alice, "quests admin complete alice hunt");
    assertThat(state(alice).completion("hunt")).isPresent();
    assertThat(state(alice).points()).isEqualTo(2);
    server.dispatchCommand(alice, "quests admin stage alice smith s");
    assertThat(state(alice).active("smith")).isPresent();
    server.dispatchCommand(alice, "quests admin reset alice hunt");
    assertThat(state(alice).completion("hunt")).isEmpty();
    server.dispatchCommand(alice, "quests admin reset alice ghost");
    assertThat(messages(alice)).contains("[Quests]: There is no quest ghost.");
  }

  @Test
  void topListsQuestPoints() throws InterruptedException {
    var alice = join("alice");
    plugin().service().adminComplete(alice.getUniqueId(), "hunt");
    await("saved", () -> plugin().service().top().join().size() == 1);
    messages(alice);
    server.dispatchCommand(alice, "quests top");
    var seen = new ArrayList<String>();
    await(
        "top shown",
        () -> {
          seen.addAll(messages(alice));
          return seen.stream().anyMatch(line -> line.contains(": 2"));
        });
    assertThat(seen).contains("[Quests]: Most quest points:");
  }

  @Test
  void quittingForgetsThePlayer() throws InterruptedException {
    var alice = join("alice");
    alice.disconnect();
    assertThat(plugin().service().state(alice.getUniqueId())).isEmpty();
  }
}
