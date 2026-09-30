package com.shepherdjerred.thestorm.tickets.app;

import java.time.Instant;
import java.util.UUID;

/**
 * One comment on a ticket, as other modules see it.
 *
 * @param id the comment id
 * @param author who wrote it
 * @param staffOnly whether players never see it
 * @param body the comment text
 * @param at when it was written
 */
public record CommentSnapshot(long id, UUID author, boolean staffOnly, String body, Instant at) {}
