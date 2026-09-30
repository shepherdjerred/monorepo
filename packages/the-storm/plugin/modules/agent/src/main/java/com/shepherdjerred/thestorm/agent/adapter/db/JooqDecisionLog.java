package com.shepherdjerred.thestorm.agent.adapter.db;

import static com.shepherdjerred.thestorm.agent.adapter.db.generated.Tables.AGENT_DECISION;

import com.shepherdjerred.thestorm.agent.adapter.db.generated.tables.records.AgentDecisionRecord;
import com.shepherdjerred.thestorm.agent.app.DecisionLog;
import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.impl.DSL;

/**
 * {@link DecisionLog} over the decision table in the shared SQLite database. Every row carries its
 * server and every read stays on this server's rows, so servers sharing a database never see each
 * other's decisions.
 */
public final class JooqDecisionLog implements DecisionLog {

  private final StormDatabase database;
  private final String server;

  public JooqDecisionLog(StormDatabase database, String server) {
    this.database = database;
    this.server = server;
  }

  @Override
  public CompletableFuture<AgentDecision> record(DecisionDraft draft, Instant at) {
    return database.write(
        dsl -> {
          var max =
              dsl.select(DSL.coalesce(DSL.max(AGENT_DECISION.ID), 0))
                  .from(AGENT_DECISION)
                  .fetchOneInto(Integer.class);
          if (max == null) {
            throw new IllegalStateException("coalesced max id came back null");
          }
          var id = max + 1;
          dsl.insertInto(AGENT_DECISION)
              .set(AGENT_DECISION.ID, id)
              .set(AGENT_DECISION.AT_MS, at.toEpochMilli())
              .set(AGENT_DECISION.PLAYER, draft.player().toString())
              .set(AGENT_DECISION.OFFENSE, draft.offense().id())
              .set(AGENT_DECISION.TICKET_ID, draft.ticketId().map(Math::toIntExact).orElse(null))
              .set(AGENT_DECISION.CLASSIFICATION, draft.classification())
              .set(AGENT_DECISION.CONFIDENCE, draft.confidence())
              .set(AGENT_DECISION.MODEL, draft.model())
              .set(AGENT_DECISION.ACTION, draft.action().id())
              .set(AGENT_DECISION.SHADOW, draft.shadow() ? 1 : 0)
              .set(AGENT_DECISION.SAMPLED, draft.sampled() ? 1 : 0)
              .set(AGENT_DECISION.LADDER_STEP, draft.ladderStep().orElse(null))
              .set(AGENT_DECISION.COST_MICROS, draft.costMicros())
              .set(AGENT_DECISION.NOTE, draft.note())
              .set(AGENT_DECISION.SERVER, server)
              .execute();
          return new AgentDecision(
              id,
              at,
              draft.player(),
              draft.offense(),
              draft.ticketId(),
              draft.classification(),
              draft.confidence(),
              draft.model(),
              draft.action(),
              draft.shadow(),
              draft.sampled(),
              draft.ladderStep(),
              draft.costMicros(),
              draft.note(),
              Optional.empty(),
              Optional.empty(),
              Optional.empty(),
              Optional.empty(),
              server);
        });
  }

  @Override
  public CompletableFuture<Optional<AgentDecision>> find(long id) {
    return database.read(
        dsl ->
            dsl.selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.ID.eq(Math.toIntExact(id)))
                .and(AGENT_DECISION.SERVER.eq(server))
                .fetchOptional()
                .map(JooqDecisionLog::toDecision));
  }

  @Override
  public CompletableFuture<Integer> strikes(
      UUID player, Offense offense, Instant since, boolean includeShadow) {
    return database.read(
        dsl ->
            dsl
                .selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.PLAYER.eq(player.toString()))
                .and(AGENT_DECISION.OFFENSE.eq(offense.id()))
                .and(AGENT_DECISION.SERVER.eq(server))
                .and(AGENT_DECISION.AT_MS.ge(since.toEpochMilli()))
                .fetch()
                .stream()
                .map(JooqDecisionLog::toDecision)
                .filter(decision -> includeShadow || !decision.shadow())
                .filter(decision -> decision.overturnedBy().isEmpty())
                .filter(decision -> decision.action().isStrike())
                .mapToInt(decision -> 1)
                .sum());
  }

  @Override
  public CompletableFuture<Boolean> overturn(long id, UUID staff, Instant at) {
    return database.write(
        dsl ->
            dsl.update(AGENT_DECISION)
                    .set(AGENT_DECISION.OVERTURNED_BY, staff.toString())
                    .set(AGENT_DECISION.OVERTURNED_MS, at.toEpochMilli())
                    .where(AGENT_DECISION.ID.eq(Math.toIntExact(id)))
                    .and(AGENT_DECISION.SERVER.eq(server))
                    .execute()
                == 1);
  }

  @Override
  public CompletableFuture<Boolean> endorse(long id, UUID staff, Instant at) {
    return database.write(
        dsl ->
            dsl.update(AGENT_DECISION)
                    .set(AGENT_DECISION.ENDORSED_BY, staff.toString())
                    .set(AGENT_DECISION.ENDORSED_MS, at.toEpochMilli())
                    .where(AGENT_DECISION.ID.eq(Math.toIntExact(id)))
                    .and(AGENT_DECISION.SERVER.eq(server))
                    .execute()
                == 1);
  }

  @Override
  public CompletableFuture<List<AgentDecision>> recent(int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.SERVER.eq(server))
                .orderBy(AGENT_DECISION.ID.desc())
                .limit(limit)
                .fetch(JooqDecisionLog::toDecision));
  }

  @Override
  public CompletableFuture<List<AgentDecision>> recentBy(UUID player, int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.PLAYER.eq(player.toString()))
                .and(AGENT_DECISION.SERVER.eq(server))
                .orderBy(AGENT_DECISION.ID.desc())
                .limit(limit)
                .fetch(JooqDecisionLog::toDecision));
  }

  @Override
  public CompletableFuture<List<AgentDecision>> escalations(int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.ACTION.eq(DecisionAction.ESCALATE.id()))
                .and(AGENT_DECISION.SERVER.eq(server))
                .and(AGENT_DECISION.OVERTURNED_BY.isNull())
                .and(AGENT_DECISION.ENDORSED_BY.isNull())
                .orderBy(AGENT_DECISION.ID.desc())
                .limit(limit)
                .fetch(JooqDecisionLog::toDecision));
  }

  @Override
  public CompletableFuture<List<AgentDecision>> samples(int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.SAMPLED.eq(1))
                .and(AGENT_DECISION.SERVER.eq(server))
                .and(AGENT_DECISION.ACTION.ne(DecisionAction.ESCALATE.id()))
                .and(AGENT_DECISION.OVERTURNED_BY.isNull())
                .and(AGENT_DECISION.ENDORSED_BY.isNull())
                .orderBy(AGENT_DECISION.ID.desc())
                .limit(limit)
                .fetch(JooqDecisionLog::toDecision));
  }

  @Override
  public CompletableFuture<List<AgentDecision>> decisionsForTicket(long ticketId) {
    return database.read(
        dsl ->
            dsl.selectFrom(AGENT_DECISION)
                .where(AGENT_DECISION.TICKET_ID.eq(Math.toIntExact(ticketId)))
                .and(AGENT_DECISION.SERVER.eq(server))
                .orderBy(AGENT_DECISION.ID)
                .fetch(JooqDecisionLog::toDecision));
  }

  private static AgentDecision toDecision(AgentDecisionRecord row) {
    return new AgentDecision(
        row.getId(),
        Instant.ofEpochMilli(row.getAtMs()),
        UUID.fromString(row.getPlayer()),
        Offense.fromId(row.getOffense()),
        Optional.ofNullable(row.getTicketId()).map(Integer::longValue),
        row.getClassification(),
        row.getConfidence(),
        row.getModel(),
        DecisionAction.fromId(row.getAction()),
        row.getShadow() != 0,
        row.getSampled() != 0,
        Optional.ofNullable(row.getLadderStep()),
        row.getCostMicros(),
        row.getNote(),
        Optional.ofNullable(row.getOverturnedBy()).map(UUID::fromString),
        Optional.ofNullable(row.getOverturnedMs()).map(Instant::ofEpochMilli),
        Optional.ofNullable(row.getEndorsedBy()).map(UUID::fromString),
        Optional.ofNullable(row.getEndorsedMs()).map(Instant::ofEpochMilli),
        row.getServer());
  }
}
