package com.shepherdjerred.thestorm.quests.adapter.db;

import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_ACTIVE;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_BOARD;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_COMPLETION;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_DISCOVERY;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_MARKER;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_OBJECTIVE;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_PENDING_WORLD;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_PLAYER;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_REPUTATION;
import static com.shepherdjerred.thestorm.quests.adapter.db.generated.Tables.QUESTS_VARIABLE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.quests.app.QuestStore;
import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest.Phase;
import com.shepherdjerred.thestorm.quests.domain.state.Board;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/**
 * Quest state in SQLite. A save replaces all of a player's rows in one transaction on the single
 * writer thread, so saves land in the order they were requested and a reader never sees half of
 * one. Times are stored as epoch milliseconds.
 */
public final class JooqQuestStore implements QuestStore {

  private final StormDatabase database;

  public JooqQuestStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<PlayerQuests> load(UUID player) {
    return database.read(dsl -> fetch(dsl, player));
  }

  @Override
  public CompletableFuture<Void> save(PlayerQuests state, List<PendingWorld> effects) {
    return database
        .write(
            dsl -> {
              store(dsl, state);
              for (var effect : effects) {
                if (!effect.player().equals(state.player())) {
                  throw new IllegalArgumentException("pending effect belongs to another player");
                }
                dsl.insertInto(QUESTS_PENDING_WORLD)
                    .set(QUESTS_PENDING_WORLD.ID, effect.id().toString())
                    .set(QUESTS_PENDING_WORLD.PLAYER_ID, effect.player().toString())
                    .set(QUESTS_PENDING_WORLD.QUEST_ID, effect.quest())
                    .set(QUESTS_PENDING_WORLD.ACTION_KIND, WorldActionCodec.kind(effect.action()))
                    .set(QUESTS_PENDING_WORLD.PAYLOAD, WorldActionCodec.payload(effect.action()))
                    .execute();
              }
              return Boolean.TRUE;
            })
        .thenAccept(stored -> {});
  }

  @Override
  public CompletableFuture<List<PendingWorld>> pending(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(QUESTS_PENDING_WORLD)
                .where(QUESTS_PENDING_WORLD.PLAYER_ID.eq(player.toString()))
                .orderBy(QUESTS_PENDING_WORLD.SEQUENCE.asc())
                .fetch(
                    row ->
                        new PendingWorld(
                            UUID.fromString(row.getId()),
                            player,
                            row.getQuestId(),
                            WorldActionCodec.decode(row.getActionKind(), row.getPayload()))));
  }

  @Override
  public CompletableFuture<Void> acknowledge(UUID effect) {
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(QUESTS_PENDING_WORLD)
                  .where(QUESTS_PENDING_WORLD.ID.eq(effect.toString()))
                  .execute();
              return Boolean.TRUE;
            })
        .thenAccept(deleted -> {});
  }

  @Override
  public CompletableFuture<List<Standing>> top(int limit) {
    return database.read(
        dsl ->
            dsl.select(QUESTS_PLAYER.PLAYER_ID, QUESTS_PLAYER.POINTS)
                .from(QUESTS_PLAYER)
                .where(QUESTS_PLAYER.POINTS.gt(0L))
                .orderBy(QUESTS_PLAYER.POINTS.desc(), QUESTS_PLAYER.PLAYER_ID.asc())
                .limit(limit)
                .fetch(row -> new Standing(UUID.fromString(row.value1()), row.value2())));
  }

  static PlayerQuests fetch(DSLContext dsl, UUID player) {
    var id = player.toString();
    var row = dsl.selectFrom(QUESTS_PLAYER).where(QUESTS_PLAYER.PLAYER_ID.eq(id)).fetchOptional();
    if (row.isEmpty()) {
      return PlayerQuests.empty(player);
    }
    var head = row.get();
    return new PlayerQuests(
        player,
        active(dsl, id),
        completions(dsl, id),
        pairs(
            dsl.select(QUESTS_VARIABLE.NAME, QUESTS_VARIABLE.VALUE)
                .from(QUESTS_VARIABLE)
                .where(QUESTS_VARIABLE.PLAYER_ID.eq(id))
                .fetchMap(QUESTS_VARIABLE.NAME, QUESTS_VARIABLE.VALUE)),
        pairs(
            dsl.select(QUESTS_REPUTATION.FACTION, QUESTS_REPUTATION.VALUE)
                .from(QUESTS_REPUTATION)
                .where(QUESTS_REPUTATION.PLAYER_ID.eq(id))
                .fetchMap(QUESTS_REPUTATION.FACTION, QUESTS_REPUTATION.VALUE)),
        head.getPoints(),
        Optional.ofNullable(head.getTracked()),
        new Board(
            head.getBoardDay(),
            head.getBoardWeek(),
            dsl.selectFrom(QUESTS_BOARD)
                .where(QUESTS_BOARD.PLAYER_ID.eq(id))
                .orderBy(QUESTS_BOARD.SLOT.asc())
                .fetch(
                    entry ->
                        new Board.Entry(
                            entry.getSlot(),
                            entry.getTemplate(),
                            Template.Period.valueOf(entry.getPeriod().toUpperCase(Locale.ROOT)),
                            Template.Kind.valueOf(entry.getKind().toUpperCase(Locale.ROOT)),
                            entry.getTarget(),
                            entry.getAmount(),
                            entry.getStars(),
                            entry.getReward(),
                            entry.getMinutes()))),
        marks(dsl, id),
        discoveries(dsl, id));
  }

  private static Map<String, ActiveQuest> active(DSLContext dsl, String id) {
    var counts = new HashMap<String, List<Integer>>();
    dsl.selectFrom(QUESTS_OBJECTIVE)
        .where(QUESTS_OBJECTIVE.PLAYER_ID.eq(id))
        .orderBy(QUESTS_OBJECTIVE.QUEST_ID.asc(), QUESTS_OBJECTIVE.POSITION.asc())
        .forEach(
            row -> {
              var list = counts.computeIfAbsent(row.getQuestId(), quest -> new ArrayList<>());
              if (row.getPosition() != list.size()) {
                throw new IllegalStateException(
                    "objective rows for " + row.getQuestId() + " skip a position");
              }
              list.add(row.getProgress());
            });
    var active = new TreeMap<String, ActiveQuest>();
    dsl.selectFrom(QUESTS_ACTIVE)
        .where(QUESTS_ACTIVE.PLAYER_ID.eq(id))
        .forEach(
            row ->
                active.put(
                    row.getQuestId(),
                    new ActiveQuest(
                        row.getQuestId(),
                        row.getStage(),
                        counts.getOrDefault(row.getQuestId(), List.of()),
                        Phase.valueOf(row.getPhase().toUpperCase(Locale.ROOT)),
                        Instant.ofEpochMilli(row.getStartedAt()),
                        Instant.ofEpochMilli(row.getStageStartedAt()))));
    return active;
  }

  private static Map<String, Completion> completions(DSLContext dsl, String id) {
    var completions = new TreeMap<String, Completion>();
    dsl.selectFrom(QUESTS_COMPLETION)
        .where(QUESTS_COMPLETION.PLAYER_ID.eq(id))
        .forEach(
            row ->
                completions.put(
                    row.getQuestId(),
                    new Completion(row.getTimes(), Instant.ofEpochMilli(row.getLastAt()))));
    return completions;
  }

  private static Map<String, NpcMark> marks(DSLContext dsl, String id) {
    var marks = new TreeMap<String, NpcMark>();
    dsl.selectFrom(QUESTS_MARKER)
        .where(QUESTS_MARKER.PLAYER_ID.eq(id))
        .forEach(
            row ->
                marks.put(row.getNpc(), NpcMark.valueOf(row.getMark().toUpperCase(Locale.ROOT))));
    return marks;
  }

  private static Map<String, Instant> discoveries(DSLContext dsl, String id) {
    var discoveries = new TreeMap<String, Instant>();
    dsl.selectFrom(QUESTS_DISCOVERY)
        .where(QUESTS_DISCOVERY.PLAYER_ID.eq(id))
        .forEach(
            row -> discoveries.put(row.getCollection(), Instant.ofEpochMilli(row.getFirstAt())));
    return discoveries;
  }

  private static Map<String, Long> pairs(Map<String, Long> fetched) {
    return new TreeMap<>(fetched);
  }

  static void store(DSLContext dsl, PlayerQuests state) {
    var id = state.player().toString();
    // Child rows cascade from the player row.
    dsl.deleteFrom(QUESTS_PLAYER).where(QUESTS_PLAYER.PLAYER_ID.eq(id)).execute();
    dsl.insertInto(QUESTS_PLAYER)
        .set(QUESTS_PLAYER.PLAYER_ID, id)
        .set(QUESTS_PLAYER.POINTS, state.points())
        .set(QUESTS_PLAYER.TRACKED, state.tracked().orElse(null))
        .set(QUESTS_PLAYER.BOARD_DAY, state.board().day())
        .set(QUESTS_PLAYER.BOARD_WEEK, state.board().week())
        .execute();
    for (var active : state.active().values()) {
      dsl.insertInto(QUESTS_ACTIVE)
          .set(QUESTS_ACTIVE.PLAYER_ID, id)
          .set(QUESTS_ACTIVE.QUEST_ID, active.quest())
          .set(QUESTS_ACTIVE.STAGE, active.stage())
          .set(QUESTS_ACTIVE.PHASE, active.phase().name().toLowerCase(Locale.ROOT))
          .set(QUESTS_ACTIVE.STARTED_AT, active.startedAt().toEpochMilli())
          .set(QUESTS_ACTIVE.STAGE_STARTED_AT, active.stageStartedAt().toEpochMilli())
          .execute();
      for (var position = 0; position < active.progress().size(); position++) {
        dsl.insertInto(QUESTS_OBJECTIVE)
            .set(QUESTS_OBJECTIVE.PLAYER_ID, id)
            .set(QUESTS_OBJECTIVE.QUEST_ID, active.quest())
            .set(QUESTS_OBJECTIVE.POSITION, position)
            .set(QUESTS_OBJECTIVE.PROGRESS, active.count(position))
            .execute();
      }
    }
    state
        .completions()
        .forEach(
            (quest, completion) ->
                dsl.insertInto(QUESTS_COMPLETION)
                    .set(QUESTS_COMPLETION.PLAYER_ID, id)
                    .set(QUESTS_COMPLETION.QUEST_ID, quest)
                    .set(QUESTS_COMPLETION.TIMES, completion.times())
                    .set(QUESTS_COMPLETION.LAST_AT, completion.last().toEpochMilli())
                    .execute());
    state
        .variables()
        .forEach(
            (name, value) ->
                dsl.insertInto(QUESTS_VARIABLE)
                    .set(QUESTS_VARIABLE.PLAYER_ID, id)
                    .set(QUESTS_VARIABLE.NAME, name)
                    .set(QUESTS_VARIABLE.VALUE, value)
                    .execute());
    state
        .reputation()
        .forEach(
            (faction, value) ->
                dsl.insertInto(QUESTS_REPUTATION)
                    .set(QUESTS_REPUTATION.PLAYER_ID, id)
                    .set(QUESTS_REPUTATION.FACTION, faction)
                    .set(QUESTS_REPUTATION.VALUE, value)
                    .execute());
    for (var entry : state.board().entries()) {
      dsl.insertInto(QUESTS_BOARD)
          .set(QUESTS_BOARD.PLAYER_ID, id)
          .set(QUESTS_BOARD.SLOT, entry.slot())
          .set(QUESTS_BOARD.TEMPLATE, entry.template())
          .set(QUESTS_BOARD.PERIOD, entry.period().name().toLowerCase(Locale.ROOT))
          .set(QUESTS_BOARD.KIND, entry.kind().name().toLowerCase(Locale.ROOT))
          .set(QUESTS_BOARD.TARGET, entry.target())
          .set(QUESTS_BOARD.AMOUNT, entry.amount())
          .set(QUESTS_BOARD.STARS, entry.stars())
          .set(QUESTS_BOARD.REWARD, entry.reward())
          .set(QUESTS_BOARD.MINUTES, entry.minutes())
          .execute();
    }
    state
        .marks()
        .forEach(
            (npc, mark) ->
                dsl.insertInto(QUESTS_MARKER)
                    .set(QUESTS_MARKER.PLAYER_ID, id)
                    .set(QUESTS_MARKER.NPC, npc)
                    .set(QUESTS_MARKER.MARK, mark.name().toLowerCase(Locale.ROOT))
                    .execute());
    state
        .discoveries()
        .forEach(
            (collection, first) ->
                dsl.insertInto(QUESTS_DISCOVERY)
                    .set(QUESTS_DISCOVERY.PLAYER_ID, id)
                    .set(QUESTS_DISCOVERY.COLLECTION, collection)
                    .set(QUESTS_DISCOVERY.FIRST_AT, first.toEpochMilli())
                    .execute());
  }
}
