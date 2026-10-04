package com.shepherdjerred.thestorm.quests.adapter.paper;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.talk;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.npcs.app.ActionRegistry;
import com.shepherdjerred.thestorm.npcs.app.DialogueRegistry;
import com.shepherdjerred.thestorm.npcs.app.NpcDirectory;
import com.shepherdjerred.thestorm.npcs.app.NpcMarkers;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import com.shepherdjerred.thestorm.quests.adapter.db.JooqQuestStore;
import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.app.Rewards;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.random.RandomGenerator;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * Wires the quests like the real module with a real SQLite store, and fakes for the NPC markers,
 * protection, player names, rewards, the journal dialog and the sidebar (MockBukkit implements
 * neither runtime dialogs nor scoreboard number formats). Not final: MockBukkit subclasses it.
 */
public class QuestsTestPlugin extends JavaPlugin {

  /** Where the test wants the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  static final ItemMatch IRON = ItemMatch.of("IRON_INGOT");

  static final QuestContent CONTENT =
      new QuestContent(
          Catalog.of(
                  List.of(
                      quest("smith")
                          .giver("thomas")
                          .stage(
                              stage("s")
                                  .objective(
                                      new Objective.Deliver("thomas", IRON, 2, Optional.empty())))
                          .reward(new Action.Points(1))
                          .reward(new Action.Crystals(10))
                          .build(),
                      quest("hunt")
                          .giver("captain")
                          .stage(
                              stage("s")
                                  .objective(new Objective.Kill("ZOMBIE", 2, Optional.empty())))
                          .reward(new Action.Points(2))
                          .build(),
                      quest("collect")
                          .giver("captain")
                          .stage(
                              stage("s")
                                  .objective(new Objective.Collect(IRON, 5, Optional.empty())))
                          .build(),
                      quest("dig")
                          .giver("captain")
                          .stage(
                              stage("s")
                                  .objective(new Objective.Mine("STONE", 1, Optional.empty())))
                          .build(),
                      quest("trip")
                          .giver("captain")
                          .stage(
                              stage("s")
                                  .objective(new Objective.Reach("far", Optional.empty()))
                                  .objective(talk("captain")))
                          .build()))
              .quests(),
          Map.of(),
          Map.of(),
          Map.of("far", new Region("far", "Far Away", "minecraft:overworld", 100, 64, 100, 5)),
          Map.of(),
          Map.of(),
          Map.of());

  static final QuestsConfig CONFIG =
      new QuestsConfig(
          "America/Los_Angeles",
          "MONDAY",
          "world",
          new QuestsConfig.Budget(25, 100),
          new QuestsConfig.Party(16, 60),
          new QuestsConfig.BoardSettings("board", 0, 0),
          20,
          60,
          8,
          10,
          new QuestsConfig.Labels(
              "Accept", "Not now", "Hand over", "Back", "Goodbye", "What can I do for you?"));

  final DialogueRegistry dialogues = new DialogueRegistry();
  final ActionRegistry actions = new ActionRegistry();
  final Map<UUID, Map<String, QuestMarker>> markers = new HashMap<>();
  final Map<UUID, Optional<Journal.Sidebar>> sidebars = new HashMap<>();
  final List<Journal.View> journals = new ArrayList<>();
  final List<String> paid = new ArrayList<>();
  private @Nullable StormDatabase database;
  private @Nullable QuestService service;
  private @Nullable Cancellable tick;

  QuestService service() {
    return Objects.requireNonNull(service, "service");
  }

  @Override
  public void onEnable() {
    var data = Objects.requireNonNull(directory, "directory");
    var db = StormDatabase.open(data.resolve("t.db"));
    database = db;
    db.migrate("quests", getClass().getClassLoader());
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            new DirectComputePool(),
            db,
            new Services(),
            data,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    var paper =
        new QuestsPaper(
            context,
            CONFIG,
            new QuestsPaper.Ports(
                new TrackLevels() {
                  @Override
                  public int level(Player player, Track track) {
                    return 0;
                  }

                  @Override
                  public boolean isLoaded(UUID player) {
                    return true;
                  }
                },
                new Allow(),
                new Npcs(),
                dialogues,
                actions,
                new Markers(),
                new Players()),
            new Sidebar());
    var built =
        new QuestService(
            new QuestService.Wiring(
                CONTENT,
                new com.shepherdjerred.thestorm.quests.domain.content.Collections(Map.of()),
                CONFIG,
                new JooqQuestStore(db),
                paper.world(CONTENT),
                new Paid(),
                npc -> npc,
                context.scheduler().mainThread(),
                InstantSource.system(),
                RandomGenerator.getDefault(),
                getComponentLogger()));
    service = built;
    tick = paper.install(built, (player, view) -> journals.add(view));
  }

  @Override
  public void onDisable() {
    if (tick != null) {
      tick.cancel();
    }
    if (database != null) {
      database.close();
    }
  }

  private static final class Allow implements Protection {
    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      return Decision.allowed();
    }

    @Override
    public Decision checkHarm(
        UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
      return Decision.allowed();
    }

    @Override
    public boolean sameLand(Location a, Location b) {
      return true;
    }
  }

  private static final class Npcs implements NpcDirectory {
    private static final List<String> IDS = List.of("board", "captain", "thomas");

    @Override
    public Optional<NpcRef> find(String id) {
      return IDS.contains(id) ? Optional.of(ref(id)) : Optional.empty();
    }

    @Override
    public List<NpcRef> all() {
      return IDS.stream().map(Npcs::ref).toList();
    }

    static NpcRef ref(String id) {
      return new NpcRef(id, id, java.util.Set.of(), Optional.empty());
    }
  }

  private final class Markers implements NpcMarkers {
    @Override
    public void set(Player player, String npc, QuestMarker marker) {
      markers.computeIfAbsent(player.getUniqueId(), ignored -> new HashMap<>()).put(npc, marker);
    }
  }

  private final class Sidebar implements SidebarDisplay {
    @Override
    public void show(Player player, Optional<Journal.Sidebar> sidebar) {
      sidebars.put(player.getUniqueId(), sidebar);
    }

    @Override
    public void forget(UUID player) {
      sidebars.remove(player);
    }
  }

  private static final class Players implements PlayerDirectory {
    @Override
    public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
      return CompletableFuture.completedFuture(Optional.empty());
    }

    @Override
    public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
      return CompletableFuture.completedFuture(
          Optional.of(
              new KnownPlayer(
                  uuid, "player-" + uuid.toString().substring(0, 4), java.time.Instant.EPOCH)));
    }
  }

  private final class Paid implements Rewards {
    @Override
    public CompletableFuture<Result<String, String>> pay(
        UUID effect, UUID player, long crystals, String reason) {
      paid.add(crystals + " " + reason);
      return CompletableFuture.completedFuture(Result.ok(crystals + " crystals"));
    }

    @Override
    public CompletableFuture<Void> grant(UUID player, String permission) {
      return CompletableFuture.runAsync(() -> {}, Runnable::run);
    }
  }
}
