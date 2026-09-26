package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.time.Instant;
import java.util.Optional;

/**
 * A trade that could not be settled automatically: a refund the ledger refused after a trade was
 * paid for but its goods could not move, or a trade still in flight at shutdown. Rare: the shop is
 * frozen while its trade settles, so a refused refund needs the refunding side to have spent the
 * crystals in the same instant. Staff settle these by hand.
 *
 * @param payer who should have paid the refund
 * @param payee who should have received it
 * @param amount how much
 * @param reason the trade's ledger reason, with what the ledger answered
 * @param held items the trade took but could not put anywhere, for staff to hand out
 * @param at when
 */
public record RefundFailure(
    AccountId payer,
    AccountId payee,
    Crystals amount,
    String reason,
    Optional<HeldItems> held,
    Instant at) {}
