package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.ChatSample;
import com.shepherdjerred.thestorm.essentials.app.ModLogRecord;
import com.shepherdjerred.thestorm.tickets.app.CommentSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.util.List;

/**
 * A ticket with everything the brain needs to work it.
 *
 * @param ticket the ticket
 * @param comments what was said on it, oldest first
 * @param reporterHistory the reporter's recent moderation history, newest first
 * @param reporterBanned whether the reporter is currently banned
 * @param reporterRecentChat the reporter's recent chat, newest first
 */
public record TriageCase(
    TicketSnapshot ticket,
    List<CommentSnapshot> comments,
    List<ModLogRecord> reporterHistory,
    boolean reporterBanned,
    List<ChatSample> reporterRecentChat) {}
