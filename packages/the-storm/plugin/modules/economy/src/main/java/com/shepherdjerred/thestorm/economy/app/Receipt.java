package com.shepherdjerred.thestorm.economy.app;

import java.time.Instant;

/**
 * A completed transfer, as recorded in the ledger.
 *
 * @param transactionId the ledger entry id
 * @param from the paying account
 * @param to the receiving account
 * @param amount what moved
 * @param reason why, for the audit log (for example {@code "quest:blacksmiths-task"})
 * @param at when
 */
public record Receipt(
    long transactionId, AccountId from, AccountId to, Crystals amount, String reason, Instant at) {}
