package com.shepherdjerred.thestorm.tickets.adapter.db;

import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET;
import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET_COMMENT;
import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET_TRIAGE;
import static com.shepherdjerred.thestorm.tickets.adapter.db.generated.Tables.TICKET_TRIAGE_DUPLICATE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Tickets and authored follow-ups belonging to one player. */
public final class JooqPlayerReset {

  private final StormDatabase database;

  public JooqPlayerReset(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<Void> reset(UUID player) {
    var id = player.toString();
    return database
        .write(
            dsl -> {
              var tickets = dsl.select(TICKET.ID).from(TICKET).where(TICKET.REPORTER.eq(id));
              dsl.deleteFrom(TICKET_TRIAGE_DUPLICATE)
                  .where(
                      TICKET_TRIAGE_DUPLICATE
                          .TICKET_ID
                          .in(tickets)
                          .or(TICKET_TRIAGE_DUPLICATE.DUPLICATE_ID.in(tickets)))
                  .execute();
              dsl.deleteFrom(TICKET_TRIAGE).where(TICKET_TRIAGE.TICKET_ID.in(tickets)).execute();
              dsl.deleteFrom(TICKET_COMMENT)
                  .where(TICKET_COMMENT.AUTHOR.eq(id).or(TICKET_COMMENT.TICKET_ID.in(tickets)))
                  .execute();
              dsl.update(TICKET).setNull(TICKET.CLAIMER).where(TICKET.CLAIMER.eq(id)).execute();
              dsl.deleteFrom(TICKET).where(TICKET.REPORTER.eq(id)).execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
