package com.shepherdjerred.thestorm.tickets.adapter.db;

import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET;
import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET_COMMENT;
import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET_TRIAGE;
import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET_TRIAGE_DUPLICATE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.tickets.adapter.db.generated.tables.records.TicketCommentRecord;
import com.shepherdjerred.thestorm.tickets.adapter.db.generated.tables.records.TicketRecord;
import com.shepherdjerred.thestorm.tickets.app.TicketStore;
import com.shepherdjerred.thestorm.tickets.domain.CommentDraft;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import com.shepherdjerred.thestorm.tickets.domain.TicketFilter;
import com.shepherdjerred.thestorm.tickets.domain.TicketLocation;
import com.shepherdjerred.thestorm.tickets.domain.TicketPriority;
import com.shepherdjerred.thestorm.tickets.domain.TicketStatus;
import com.shepherdjerred.thestorm.tickets.domain.Triage;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;

/**
 * {@link TicketStore} over the ticket tables in the shared SQLite database. Every ticket carries
 * its server and every read stays on this server's rows, so servers sharing a database never see
 * each other's tickets.
 */
public final class JooqTicketStore implements TicketStore {

  private final StormDatabase database;
  private final String server;

  public JooqTicketStore(StormDatabase database, String server) {
    this.database = database;
    this.server = server;
  }

  @Override
  public CompletableFuture<Ticket> insert(TicketDraft draft, Instant at) {
    return database.write(
        dsl -> {
          var id = nextTicketId(dsl);
          dsl.insertInto(TICKET)
              .set(TICKET.ID, id)
              .set(TICKET.REPORTER, draft.reporter().toString())
              .set(TICKET.CATEGORY, draft.category().id())
              .set(TICKET.STATUS, TicketStatus.OPEN.id())
              .set(TICKET.PRIORITY, TicketPriority.NORMAL.id())
              .set(TICKET.SUMMARY, draft.summary())
              .set(TICKET.WORLD, draft.location().map(TicketLocation::world).orElse(null))
              .set(TICKET.X, draft.location().map(TicketLocation::x).orElse(null))
              .set(TICKET.Y, draft.location().map(TicketLocation::y).orElse(null))
              .set(TICKET.Z, draft.location().map(TicketLocation::z).orElse(null))
              .set(TICKET.CREATED_MS, at.toEpochMilli())
              .set(TICKET.UPDATED_MS, at.toEpochMilli())
              .set(TICKET.SERVER, server)
              .execute();
          return Ticket.open(id, draft, at, server);
        });
  }

  @Override
  public CompletableFuture<Optional<Ticket>> find(long id) {
    return database.read(
        dsl ->
            dsl.selectFrom(TICKET)
                .where(TICKET.ID.eq(Math.toIntExact(id)))
                .and(TICKET.SERVER.eq(server))
                .fetchOptional()
                .map(
                    row ->
                        toTicket(row, Optional.ofNullable(triagesByTicket(dsl).get(row.getId())))));
  }

  @Override
  public CompletableFuture<List<Ticket>> list(TicketFilter filter) {
    return database.read(
        dsl -> {
          var triages = triagesByTicket(dsl);
          return dsl
              .selectFrom(TICKET)
              .where(TICKET.SERVER.eq(server))
              .orderBy(TICKET.ID)
              .fetch(row -> toTicket(row, Optional.ofNullable(triages.get(row.getId()))))
              .stream()
              .filter(filter::matches)
              .toList();
        });
  }

  @Override
  public CompletableFuture<Void> save(Ticket ticket) {
    return database
        .write(
            dsl -> {
              dsl.update(TICKET)
                  .set(TICKET.STATUS, ticket.status().id())
                  .set(TICKET.PRIORITY, ticket.priority().id())
                  .set(TICKET.UPDATED_MS, ticket.updatedAt().toEpochMilli())
                  .set(TICKET.CLAIMER, ticket.claimer().map(UUID::toString).orElse(null))
                  .where(TICKET.ID.eq(Math.toIntExact(ticket.id())))
                  .and(TICKET.SERVER.eq(server))
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<TicketComment> addComment(
      long ticketId, CommentDraft draft, Instant at) {
    return database.write(
        dsl -> {
          var id = nextCommentId(dsl);
          dsl.insertInto(TICKET_COMMENT)
              .set(TICKET_COMMENT.ID, id)
              .set(TICKET_COMMENT.TICKET_ID, Math.toIntExact(ticketId))
              .set(TICKET_COMMENT.AUTHOR, draft.author().toString())
              .set(TICKET_COMMENT.STAFF_ONLY, draft.staffOnly() ? 1 : 0)
              .set(TICKET_COMMENT.BODY, draft.body())
              .set(TICKET_COMMENT.AT_MS, at.toEpochMilli())
              .execute();
          return new TicketComment(id, draft.author(), draft.staffOnly(), draft.body(), at);
        });
  }

  @Override
  public CompletableFuture<List<TicketComment>> comments(long ticketId) {
    return database.read(
        dsl ->
            dsl.selectFrom(TICKET_COMMENT)
                .where(TICKET_COMMENT.TICKET_ID.eq((int) ticketId))
                .orderBy(TICKET_COMMENT.ID)
                .fetch(JooqTicketStore::toComment));
  }

  @Override
  public CompletableFuture<Void> saveTriage(long ticketId, Triage triage) {
    return database
        .write(
            dsl -> {
              var id = Math.toIntExact(ticketId);
              dsl.deleteFrom(TICKET_TRIAGE_DUPLICATE)
                  .where(TICKET_TRIAGE_DUPLICATE.TICKET_ID.eq(id))
                  .execute();
              dsl.deleteFrom(TICKET_TRIAGE).where(TICKET_TRIAGE.TICKET_ID.eq(id)).execute();
              dsl.insertInto(TICKET_TRIAGE)
                  .set(TICKET_TRIAGE.TICKET_ID, id)
                  .set(TICKET_TRIAGE.PRIORITY, triage.priority().id())
                  .set(TICKET_TRIAGE.EVIDENCE, triage.evidence())
                  .set(TICKET_TRIAGE.DRAFT_REPLY, triage.draftReply())
                  .set(TICKET_TRIAGE.AT_MS, triage.at().toEpochMilli())
                  .execute();
              for (var duplicate : triage.duplicateIds()) {
                dsl.insertInto(TICKET_TRIAGE_DUPLICATE)
                    .set(TICKET_TRIAGE_DUPLICATE.TICKET_ID, id)
                    .set(TICKET_TRIAGE_DUPLICATE.DUPLICATE_ID, Math.toIntExact(duplicate))
                    .execute();
              }
              return true;
            })
        .thenAccept(done -> {});
  }

  private static int nextTicketId(DSLContext dsl) {
    return maxId(dsl, TICKET.ID) + 1;
  }

  private static int nextCommentId(DSLContext dsl) {
    return maxId(dsl, TICKET_COMMENT.ID) + 1;
  }

  private static int maxId(DSLContext dsl, org.jooq.TableField<?, Integer> column) {
    var max =
        dsl.select(DSL.coalesce(DSL.max(column), 0))
            .from(column.getTable())
            .fetchOneInto(Integer.class);
    if (max == null) {
      throw new IllegalStateException("coalesced max id came back null");
    }
    return max;
  }

  private static Map<Integer, Triage> triagesByTicket(DSLContext dsl) {
    var duplicates =
        dsl.selectFrom(TICKET_TRIAGE_DUPLICATE)
            .fetchGroups(row -> row.getTicketId(), row -> row.getDuplicateId());
    Map<Integer, Triage> triages = new HashMap<>();
    for (var row : dsl.selectFrom(TICKET_TRIAGE).fetch()) {
      triages.put(
          row.getTicketId(),
          new Triage(
              TicketPriority.fromId(row.getPriority()),
              duplicates.getOrDefault(row.getTicketId(), List.of()).stream()
                  .map(Integer::longValue)
                  .toList(),
              row.getEvidence(),
              row.getDraftReply(),
              Instant.ofEpochMilli(row.getAtMs())));
    }
    return triages;
  }

  private static Ticket toTicket(TicketRecord row, Optional<Triage> triage) {
    return new Ticket(
        row.getId(),
        UUID.fromString(row.getReporter()),
        TicketCategory.fromId(row.getCategory()),
        TicketStatus.fromId(row.getStatus()),
        TicketPriority.fromId(row.getPriority()),
        row.getSummary(),
        toLocation(row),
        Instant.ofEpochMilli(row.getCreatedMs()),
        Instant.ofEpochMilli(row.getUpdatedMs()),
        Optional.ofNullable(row.getClaimer()).map(UUID::fromString),
        triage,
        row.getServer());
  }

  private static Optional<TicketLocation> toLocation(TicketRecord row) {
    if (row.getWorld() == null) {
      return Optional.empty();
    }
    if (row.getX() == null || row.getY() == null || row.getZ() == null) {
      throw new IllegalStateException("ticket " + row.getId() + " has a world without coords");
    }
    return Optional.of(new TicketLocation(row.getWorld(), row.getX(), row.getY(), row.getZ()));
  }

  private static TicketComment toComment(TicketCommentRecord row) {
    return new TicketComment(
        row.getId(),
        UUID.fromString(row.getAuthor()),
        row.getStaffOnly() != 0,
        row.getBody(),
        Instant.ofEpochMilli(row.getAtMs()));
  }
}
