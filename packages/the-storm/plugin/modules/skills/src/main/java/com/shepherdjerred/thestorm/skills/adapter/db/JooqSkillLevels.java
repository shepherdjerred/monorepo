package com.shepherdjerred.thestorm.skills.adapter.db;

import static com.shepherdjerred.thestorm.skills.adapter.db.generated.Tables.SKILLS_EXPERIENCE;
import static com.shepherdjerred.thestorm.skills.adapter.db.generated.Tables.SKILLS_FALLING_BLOCK;
import static com.shepherdjerred.thestorm.skills.adapter.db.generated.Tables.SKILLS_PLACED_BLOCK;
import static com.shepherdjerred.thestorm.skills.adapter.db.generated.Tables.SKILLS_PLAYER;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.skills.app.BlockMove;
import com.shepherdjerred.thestorm.skills.app.BlockPosition;
import com.shepherdjerred.thestorm.skills.app.RankedSkillPlayer;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.app.SkillProgress;
import com.shepherdjerred.thestorm.skills.domain.Experience;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** Serializes awards on the shared SQLite writer; no database work runs on Paper's main thread. */
public final class JooqSkillLevels implements SkillLevels {

  private final StormDatabase database;

  public JooqSkillLevels(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<SkillProgress> progress(UUID playerId) {
    return database.read(dsl -> readProgress(dsl, playerId));
  }

  @Override
  public CompletableFuture<SkillProgress> award(
      UUID playerId, String name, Skill skill, int experience) {
    if (experience <= 0) {
      throw new IllegalArgumentException("experience award must be positive");
    }
    return database.write(
        dsl -> {
          String id = playerId.toString();
          dsl.insertInto(SKILLS_PLAYER)
              .set(SKILLS_PLAYER.PLAYER_ID, id)
              .set(SKILLS_PLAYER.LAST_NAME, name)
              .onConflict(SKILLS_PLAYER.PLAYER_ID)
              .doUpdate()
              .set(SKILLS_PLAYER.LAST_NAME, name)
              .execute();
          long before =
              dsl.select(SKILLS_EXPERIENCE.EXPERIENCE)
                  .from(SKILLS_EXPERIENCE)
                  .where(
                      SKILLS_EXPERIENCE.PLAYER_ID.eq(id), SKILLS_EXPERIENCE.SKILL.eq(skill.name()))
                  .fetchOptional(SKILLS_EXPERIENCE.EXPERIENCE)
                  .orElse(0L);
          long after = Experience.award(before, experience);
          dsl.insertInto(SKILLS_EXPERIENCE)
              .set(SKILLS_EXPERIENCE.PLAYER_ID, id)
              .set(SKILLS_EXPERIENCE.SKILL, skill.name())
              .set(SKILLS_EXPERIENCE.EXPERIENCE, after)
              .set(SKILLS_EXPERIENCE.LEVEL, Experience.level(after))
              .onConflict(SKILLS_EXPERIENCE.PLAYER_ID, SKILLS_EXPERIENCE.SKILL)
              .doUpdate()
              .set(SKILLS_EXPERIENCE.EXPERIENCE, after)
              .set(SKILLS_EXPERIENCE.LEVEL, Experience.level(after))
              .execute();
          return readProgress(dsl, playerId);
        });
  }

  @Override
  public CompletableFuture<List<RankedSkillPlayer>> top(int limit) {
    if (limit < 1 || limit > 50) {
      throw new IllegalArgumentException("limit must be between 1 and 50");
    }
    return database.read(
        dsl -> {
          Map<UUID, RankedSkillPlayer> players = new HashMap<>();
          dsl.select(SKILLS_PLAYER.PLAYER_ID, SKILLS_PLAYER.LAST_NAME, SKILLS_EXPERIENCE.LEVEL)
              .from(SKILLS_PLAYER)
              .leftJoin(SKILLS_EXPERIENCE)
              .on(SKILLS_PLAYER.PLAYER_ID.eq(SKILLS_EXPERIENCE.PLAYER_ID))
              .fetch(
                  row -> {
                    var id = UUID.fromString(row.value1());
                    int level = row.value3() == null ? 0 : row.value3();
                    players.merge(
                        id,
                        new RankedSkillPlayer(id, row.value2(), level),
                        (prior, next) ->
                            new RankedSkillPlayer(id, next.name(), prior.powerLevel() + level));
                    return id;
                  });
          var ranking = new ArrayList<>(players.values());
          ranking.sort(
              Comparator.comparingInt(RankedSkillPlayer::powerLevel)
                  .reversed()
                  .thenComparing(RankedSkillPlayer::name)
                  .thenComparing(RankedSkillPlayer::playerId));
          return List.copyOf(ranking.subList(0, Math.min(limit, ranking.size())));
        });
  }

  @Override
  public CompletableFuture<Boolean> markPlaced(BlockPosition position) {
    return database.write(
        dsl ->
            dsl.insertInto(SKILLS_PLACED_BLOCK)
                    .set(SKILLS_PLACED_BLOCK.WORLD_ID, position.world().toString())
                    .set(SKILLS_PLACED_BLOCK.X, position.x())
                    .set(SKILLS_PLACED_BLOCK.Y, position.y())
                    .set(SKILLS_PLACED_BLOCK.Z, position.z())
                    .onConflictDoNothing()
                    .execute()
                > 0);
  }

  @Override
  public CompletableFuture<Boolean> wasPlacedAndForget(BlockPosition position) {
    return database.write(
        dsl ->
            dsl.deleteFrom(SKILLS_PLACED_BLOCK)
                    .where(
                        SKILLS_PLACED_BLOCK.WORLD_ID.eq(position.world().toString()),
                        SKILLS_PLACED_BLOCK.X.eq(position.x()),
                        SKILLS_PLACED_BLOCK.Y.eq(position.y()),
                        SKILLS_PLACED_BLOCK.Z.eq(position.z()))
                    .execute()
                > 0);
  }

  @Override
  public CompletableFuture<Boolean> movePlaced(List<BlockMove> moves) {
    return database.write(
        dsl -> {
          var markedDestinations = new ArrayList<BlockPosition>();
          for (var move : moves) {
            var from = move.from();
            if (dsl.deleteFrom(SKILLS_PLACED_BLOCK)
                    .where(
                        SKILLS_PLACED_BLOCK.WORLD_ID.eq(from.world().toString()),
                        SKILLS_PLACED_BLOCK.X.eq(from.x()),
                        SKILLS_PLACED_BLOCK.Y.eq(from.y()),
                        SKILLS_PLACED_BLOCK.Z.eq(from.z()))
                    .execute()
                > 0) {
              markedDestinations.add(move.to());
            }
          }
          // Delete every source first: piston groups often move into another block's old location.
          for (var to : markedDestinations) {
            dsl.insertInto(SKILLS_PLACED_BLOCK)
                .set(SKILLS_PLACED_BLOCK.WORLD_ID, to.world().toString())
                .set(SKILLS_PLACED_BLOCK.X, to.x())
                .set(SKILLS_PLACED_BLOCK.Y, to.y())
                .set(SKILLS_PLACED_BLOCK.Z, to.z())
                .onConflictDoNothing()
                .execute();
          }
          return !markedDestinations.isEmpty();
        });
  }

  @Override
  public CompletableFuture<Boolean> growPlacedTree(
      List<BlockPosition> saplings, List<BlockPosition> logs) {
    return database.write(
        dsl -> {
          boolean placed = false;
          for (var sapling : saplings) {
            placed |=
                dsl.deleteFrom(SKILLS_PLACED_BLOCK)
                        .where(
                            SKILLS_PLACED_BLOCK.WORLD_ID.eq(sapling.world().toString()),
                            SKILLS_PLACED_BLOCK.X.eq(sapling.x()),
                            SKILLS_PLACED_BLOCK.Y.eq(sapling.y()),
                            SKILLS_PLACED_BLOCK.Z.eq(sapling.z()))
                        .execute()
                    > 0;
          }
          if (placed) {
            for (var log : logs) {
              dsl.insertInto(SKILLS_PLACED_BLOCK)
                  .set(SKILLS_PLACED_BLOCK.WORLD_ID, log.world().toString())
                  .set(SKILLS_PLACED_BLOCK.X, log.x())
                  .set(SKILLS_PLACED_BLOCK.Y, log.y())
                  .set(SKILLS_PLACED_BLOCK.Z, log.z())
                  .onConflictDoNothing()
                  .execute();
            }
          }
          return placed;
        });
  }

  @Override
  public CompletableFuture<Boolean> launchFalling(BlockPosition source, UUID entityId) {
    return database.write(
        dsl -> {
          boolean placed =
              dsl.deleteFrom(SKILLS_PLACED_BLOCK)
                      .where(
                          SKILLS_PLACED_BLOCK.WORLD_ID.eq(source.world().toString()),
                          SKILLS_PLACED_BLOCK.X.eq(source.x()),
                          SKILLS_PLACED_BLOCK.Y.eq(source.y()),
                          SKILLS_PLACED_BLOCK.Z.eq(source.z()))
                      .execute()
                  > 0;
          if (placed) {
            dsl.insertInto(SKILLS_FALLING_BLOCK)
                .set(SKILLS_FALLING_BLOCK.ENTITY_ID, entityId.toString())
                .onConflictDoNothing()
                .execute();
          }
          return placed;
        });
  }

  @Override
  public CompletableFuture<Boolean> landFalling(UUID entityId, BlockPosition destination) {
    return database.write(
        dsl -> {
          boolean placed =
              dsl.deleteFrom(SKILLS_FALLING_BLOCK)
                      .where(SKILLS_FALLING_BLOCK.ENTITY_ID.eq(entityId.toString()))
                      .execute()
                  > 0;
          if (placed) {
            dsl.insertInto(SKILLS_PLACED_BLOCK)
                .set(SKILLS_PLACED_BLOCK.WORLD_ID, destination.world().toString())
                .set(SKILLS_PLACED_BLOCK.X, destination.x())
                .set(SKILLS_PLACED_BLOCK.Y, destination.y())
                .set(SKILLS_PLACED_BLOCK.Z, destination.z())
                .onConflictDoNothing()
                .execute();
          }
          return placed;
        });
  }

  @Override
  public CompletableFuture<Boolean> forgetFalling(UUID entityId) {
    return database.write(
        dsl ->
            dsl.deleteFrom(SKILLS_FALLING_BLOCK)
                    .where(SKILLS_FALLING_BLOCK.ENTITY_ID.eq(entityId.toString()))
                    .execute()
                > 0);
  }

  private static SkillProgress readProgress(DSLContext dsl, UUID playerId) {
    var experience = new EnumMap<Skill, Long>(Skill.class);
    dsl.select(SKILLS_EXPERIENCE.SKILL, SKILLS_EXPERIENCE.EXPERIENCE)
        .from(SKILLS_EXPERIENCE)
        .where(SKILLS_EXPERIENCE.PLAYER_ID.eq(playerId.toString()))
        .fetch(
            row -> {
              experience.put(Skill.valueOf(row.value1()), row.value2());
              return row.value1();
            });
    return new SkillProgress(experience);
  }
}
