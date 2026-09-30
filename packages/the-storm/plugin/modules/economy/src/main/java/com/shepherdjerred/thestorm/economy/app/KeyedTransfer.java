package com.shepherdjerred.thestorm.economy.app;

import java.util.UUID;

/** One transfer whose stable key makes retries return the original ledger receipt. */
public record KeyedTransfer(
    UUID key, AccountId from, AccountId to, Crystals amount, String reason) {}
