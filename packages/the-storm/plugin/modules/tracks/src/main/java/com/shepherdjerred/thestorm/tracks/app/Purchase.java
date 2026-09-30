package com.shepherdjerred.thestorm.tracks.app;

/**
 * A completed track purchase.
 *
 * @param quote what was bought and what it cost
 * @param primary whether this purchase made {@code quote.track()} the player's primary track
 * @param transactionId the economy ledger entry that paid for it
 */
public record Purchase(Quote quote, boolean primary, long transactionId) {}
