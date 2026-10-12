package com.shepherdjerred.thestorm.economy.app;

import java.util.UUID;

/**
 * One transfer whose stable key makes retries return the original ledger receipt. A key belongs to
 * exactly one transfer: reusing it with another currency, amount, account or reason is refused.
 */
public record KeyedTransfer(UUID key, AccountId from, AccountId to, Money amount, String reason) {}
