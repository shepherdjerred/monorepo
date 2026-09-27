package com.shepherdjerred.thestorm.discord.app;

/**
 * A ticket change, rendered for Discord. Plain data so any module can post without depending on the
 * tickets module: names are already resolved, ids already text.
 *
 * @param id the ticket id
 * @param category the category id, for example {@code grief}
 * @param priority the priority id, for example {@code urgent}
 * @param reporter who filed it
 * @param summary what happened, in the reporter's words
 * @param staff who handled or owns it, or {@code staff} when nobody does
 * @param evidence the triage evidence, when triaged
 * @param server which server it belongs to
 */
public record TicketDetails(
    long id,
    String category,
    String priority,
    String reporter,
    String summary,
    String staff,
    String evidence,
    String server) {}
