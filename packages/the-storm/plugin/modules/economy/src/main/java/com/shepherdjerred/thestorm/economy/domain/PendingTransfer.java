package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.Crystals;

/**
 * A transfer together with the balances it would change, as read inside the writing transaction.
 * The server's balance is meaningless (it is unlimited) and is passed as {@link Crystals#ZERO}.
 *
 * @param transfer what is requested
 * @param payerBalance the paying account's current balance
 * @param payeeBalance the receiving account's current balance
 */
public record PendingTransfer(Transfer transfer, Crystals payerBalance, Crystals payeeBalance) {}
