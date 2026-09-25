package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.time.Instant;

/**
 * A refund the ledger refused after a trade was paid for but its goods could not move. Rare: the
 * shop is frozen while its trade settles, so this needs the refunding side to have spent the
 * crystals in the same instant. Staff settle these by hand.
 *
 * @param payer who should have paid the refund
 * @param payee who should have received it
 * @param amount how much
 * @param reason the trade's ledger reason
 * @param at when
 */
public record RefundFailure(
    AccountId payer, AccountId payee, Crystals amount, String reason, Instant at) {}
