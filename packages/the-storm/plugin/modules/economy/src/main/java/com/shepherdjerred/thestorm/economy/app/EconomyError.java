package com.shepherdjerred.thestorm.economy.app;

/** Why a transfer was refused. */
public sealed interface EconomyError {

  /** The payer cannot cover the amount. */
  record InsufficientFunds(AccountId account, Money balance, Money required)
      implements EconomyError {}

  /** Transfers must move at least one unit of {@code currency}. */
  record ZeroAmount(CurrencyId currency) implements EconomyError {}

  /** An account cannot pay itself. */
  record SameAccount(AccountId account) implements EconomyError {}
}
