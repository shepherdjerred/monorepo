package com.shepherdjerred.thestorm.quests.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.quests.domain.engine.KillCredit;
import com.shepherdjerred.thestorm.quests.domain.engine.PickupCredit;
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
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.ItemMergeEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.PluginDescriptionFile;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.EntityMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.simulate.entity.PlayerSimulation;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The Paper side on MockBukkit: players load their quests on join, NPC dialogue and actions accept
 * and hand in, listeners turn kills, mining and movement into progress with party credit, markers
 * follow, and {@code /quests} works. Dialogs and the scoreboard sidebar use Paper APIs MockBukkit
 * lacks; those require real-server acceptance.
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
    await(
        name + " loaded and board saved",
        () ->
            plugin()
                .service()
                .state(player.getUniqueId())
                .map(state -> !state.board().day().isEmpty())
                .orElse(false));
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
    await("smith accepted", () -> state(alice).active("smith").isPresent());
    assertThat(state(alice).active("smith")).isPresent();
    assertThat(plugin().sidebars.get(alice.getUniqueId())).isPresent();
    alice.getInventory().addItem(new ItemStack(Material.IRON_INGOT, 5));
    plugin().service().tick();
    assertThat(plugin().markers.get(alice.getUniqueId()))
        .containsEntry("thomas", QuestMarker.TURN_IN);
    clickAction(alice, "thomas", id -> id.equals("quests.turnin.smith"));
    await(
        "smith completed",
        () ->
            plugin()
                .service()
                .state(alice.getUniqueId())
                .map(quests -> quests.completion("smith").isPresent())
                .orElse(false));
    assertThat(state(alice).completion("smith")).isPresent();
    await(
        "smith world actions delivered",
        () ->
            alice.getInventory().all(Material.IRON_INGOT).values().stream()
                        .mapToInt(ItemStack::getAmount)
                        .sum()
                    == 3
                && plugin().paid.size() == 1);
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
    await(
        "hunts accepted",
        () -> state(alice).active("hunt").isPresent() && state(bob).active("hunt").isPresent());
    var zombie = (LivingEntity) world.spawnEntity(new Location(world, 1, 64, 0), EntityType.ZOMBIE);
    ((EntityMock) zombie).setSpawnReason(CreatureSpawnEvent.SpawnReason.NATURAL);
    zombie.setKiller(alice);
    zombie.setHealth(0);
    await(
        "shared kill saved",
        () -> state(bob).active("hunt").orElseThrow().progress().getFirst() == 1);
    assertThat(state(alice).active("hunt").orElseThrow().progress()).containsExactly(1);
    assertThat(state(bob).active("hunt").orElseThrow().progress()).containsExactly(1);

    var spawner =
        (LivingEntity) world.spawnEntity(new Location(world, 1, 64, 0), EntityType.ZOMBIE);
    ((EntityMock) spawner).setSpawnReason(CreatureSpawnEvent.SpawnReason.SPAWNER);
    spawner.setKiller(alice);
    spawner.setHealth(0);
    var questSpawned =
        (LivingEntity) world.spawnEntity(new Location(world, 1, 64, 0), EntityType.ZOMBIE);
    ((EntityMock) questSpawned).setSpawnReason(CreatureSpawnEvent.SpawnReason.NATURAL);
    questSpawned.addScoreboardTag(KillCredit.QUEST_SPAWNED);
    questSpawned.setKiller(alice);
    questSpawned.setHealth(0);
    assertThat(state(alice).active("hunt").orElseThrow().progress()).containsExactly(1);
    assertThat(state(bob).active("hunt").orElseThrow().progress()).containsExactly(1);
  }

  @Test
  void questsOnlyProgressInTheMainWorld() throws InterruptedException {
    var wilds = server.addSimpleWorld("wilds");
    var alice = join("alice");
    alice.teleport(new Location(wilds, 0, 64, 0));
    server.dispatchCommand(alice, "quests");
    assertThat(messages(alice)).contains("[Quests]: Quests are only available in world.");
    plugin().service().accept(alice.getUniqueId(), "hunt", "captain");
    assertThat(state(alice).active("hunt")).isEmpty();

    alice.teleport(new Location(world, 0, 64, 0));
    plugin().service().accept(alice.getUniqueId(), "hunt", "captain");
    await("main-world hunt accepted", () -> state(alice).active("hunt").isPresent());
    assertThat(state(alice).active("hunt")).isPresent();
    alice.teleport(new Location(wilds, 0, 64, 0));
    assertThat(plugin().sidebars.get(alice.getUniqueId())).isEmpty();
    var zombie = (LivingEntity) wilds.spawnEntity(new Location(wilds, 1, 64, 0), EntityType.ZOMBIE);
    ((EntityMock) zombie).setSpawnReason(CreatureSpawnEvent.SpawnReason.NATURAL);
    zombie.setKiller(alice);
    zombie.setHealth(0);
    assertThat(state(alice).active("hunt").orElseThrow().progress()).containsExactly(0);
    alice.teleport(new Location(world, 0, 64, 0));
    var mainZombie =
        (LivingEntity) world.spawnEntity(new Location(world, 1, 64, 0), EntityType.ZOMBIE);
    ((EntityMock) mainZombie).setSpawnReason(CreatureSpawnEvent.SpawnReason.NATURAL);
    mainZombie.setKiller(alice);
    mainZombie.setHealth(0);
    await(
        "main-world kill saved",
        () -> state(alice).active("hunt").orElseThrow().progress().getFirst() == 1);
    assertThat(state(alice).active("hunt").orElseThrow().progress()).containsExactly(1);
  }

  @Test
  void enteringMainWorldLoadsAnUnloadedQuestSession() throws InterruptedException {
    var wilds = server.addSimpleWorld("wilds");
    var alice = join("alice");
    alice.teleport(new Location(wilds, 0, 64, 0));
    plugin().service().quit(alice.getUniqueId());
    assertThat(plugin().service().state(alice.getUniqueId())).isEmpty();

    alice.teleport(new Location(world, 0, 64, 0));
    await(
        "main-world session loaded",
        () -> plugin().service().state(alice.getUniqueId()).isPresent());
  }

  @Test
  void pickupsCountOnlyNewItemsAndNeverCountPlayerDrops() throws InterruptedException {
    var alice = join("alice");
    plugin().service().accept(alice.getUniqueId(), "collect", "captain");
    await("collection accepted", () -> state(alice).active("collect").isPresent());
    var at = new Location(world, 1, 64, 0);
    Item dropped = world.dropItem(at, new ItemStack(Material.IRON_INGOT, 6));
    server.getPluginManager().callEvent(new PlayerDropItemEvent(alice, dropped));
    server.getPluginManager().callEvent(new EntityPickupItemEvent(alice, dropped, 0));
    assertThat(state(alice).active("collect").orElseThrow().progress()).containsExactly(0);

    Item natural = world.dropItem(at, new ItemStack(Material.IRON_INGOT, 6));
    server.getPluginManager().callEvent(new EntityPickupItemEvent(alice, natural, 4));
    await(
        "natural pickup saved",
        () -> state(alice).active("collect").orElseThrow().progress().getFirst() == 2);
    assertThat(state(alice).active("collect").orElseThrow().progress()).containsExactly(2);

    Item merged = world.dropItem(at, new ItemStack(Material.IRON_INGOT, 6));
    server.getPluginManager().callEvent(new ItemMergeEvent(dropped, merged));
    assertThat(merged.getScoreboardTags()).contains(PickupCredit.PLAYER_DROPPED);
    server.getPluginManager().callEvent(new EntityPickupItemEvent(alice, merged, 0));
    assertThat(state(alice).active("collect").orElseThrow().progress()).containsExactly(2);

    Item more = world.dropItem(at, new ItemStack(Material.IRON_INGOT, 5));
    server.getPluginManager().callEvent(new EntityPickupItemEvent(alice, more, 1));
    await("collection completed", () -> state(alice).completion("collect").isPresent());
    assertThat(state(alice).completion("collect")).isPresent();
  }

  @Test
  void placedBlocksDoNotCountAsMined() throws InterruptedException {
    var alice = join("alice");
    plugin().service().accept(alice.getUniqueId(), "dig", "captain");
    await("dig accepted", () -> state(alice).active("dig").isPresent());
    var at = new Location(world, 5, 64, 5);
    new PlayerSimulation(alice).simulateBlockPlace(Material.STONE, at);
    new PlayerSimulation(alice).simulateBlockBreak(at.getBlock());
    assertThat(state(alice).active("dig")).isPresent();
    var natural = new Location(world, 6, 64, 5);
    natural.getBlock().setType(Material.STONE);
    new PlayerSimulation(alice).simulateBlockBreak(natural.getBlock());
    await("dig completed", () -> state(alice).completion("dig").isPresent());
    assertThat(state(alice).completion("dig")).isPresent();
  }

  @Test
  void walkingIntoARegionCountsThenReporting() throws InterruptedException {
    assertThat(world.getKey().asString()).isEqualTo("minecraft:overworld");
    var alice = join("alice");
    plugin().service().accept(alice.getUniqueId(), "trip", "captain");
    await("trip accepted", () -> state(alice).active("trip").isPresent());
    new PlayerSimulation(alice).simulatePlayerMove(new Location(world, 50, 64, 50));
    assertThat(state(alice).active("trip").orElseThrow().progress()).containsExactly(0, 0);
    new PlayerSimulation(alice).simulatePlayerMove(new Location(world, 101, 64, 100));
    await(
        "region visit saved",
        () -> state(alice).active("trip").orElseThrow().progress().getFirst() == 1);
    assertThat(state(alice).active("trip").orElseThrow().progress()).containsExactly(1, 0);
    clickAction(alice, "captain", id -> id.equals("quests.turnin.trip"));
    await("trip completed", () -> state(alice).completion("trip").isPresent());
    assertThat(state(alice).completion("trip")).isPresent();
  }

  @Test
  void commandsShowTrackAndAbandon() throws InterruptedException {
    var alice = join("alice");
    var service = plugin().service();
    service.accept(alice.getUniqueId(), "hunt", "captain");
    service.accept(alice.getUniqueId(), "dig", "captain");
    await(
        "both quests accepted",
        () -> state(alice).active("hunt").isPresent() && state(alice).active("dig").isPresent());
    messages(alice);
    server.dispatchCommand(alice, "quests");
    assertThat(plugin().journals)
        .singleElement()
        .satisfies(view -> assertThat(view.active()).containsExactly("dig", "hunt"));
    server.dispatchCommand(alice, "quests track dig");
    await("dig tracked", () -> state(alice).tracked().filter("dig"::equals).isPresent());
    assertThat(state(alice).tracked()).contains("dig");
    server.dispatchCommand(alice, "quests abandon dig");
    await("dig abandoned", () -> state(alice).active("dig").isEmpty());
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
    await("admin completion saved", () -> state(alice).completion("hunt").isPresent());
    assertThat(state(alice).completion("hunt")).isPresent();
    assertThat(state(alice).points()).isEqualTo(2);
    server.dispatchCommand(alice, "quests admin stage alice smith s");
    await("admin stage saved", () -> state(alice).active("smith").isPresent());
    assertThat(state(alice).active("smith")).isPresent();
    server.dispatchCommand(alice, "quests admin reset alice hunt");
    await("admin reset saved", () -> state(alice).completion("hunt").isEmpty());
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
