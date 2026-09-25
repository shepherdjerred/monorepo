package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;

/** Says, in a sentence a player understands, why a transfer was refused. */
public final class Explanations {

  private Explanations() {}

  public static String explain(EconomyError error, CrystalFormat format) {
    return switch (error) {
      case EconomyError.InsufficientFunds(var _, var balance, var required) ->
          "Not enough "
              + format.currency().plural()
              + ": that needs "
              + format.words(required)
              + " but the balance is "
              + format.words(balance)
              + ".";
      case EconomyError.ZeroAmount() ->
          "The amount must be at least " + format.words(new Crystals(1)) + ".";
      case EconomyError.SameAccount(var _) -> "You can't pay yourself.";
    };
  }
}
