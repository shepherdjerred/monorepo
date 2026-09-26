package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link Rewards} through the economy's wallets and a permission granter. */
public final class WalletRewards implements Rewards {

  private final Wallets wallets;
  private final CrystalFormatter formatter;
  private final PermissionGrants grants;

  public WalletRewards(Wallets wallets, CrystalFormatter formatter, PermissionGrants grants) {
    this.wallets = wallets;
    this.formatter = formatter;
    this.grants = grants;
  }

  @Override
  public CompletableFuture<Result<String, String>> pay(UUID player, long crystals, String reason) {
    var amount = Crystals.of(crystals);
    return wallets
        .transfer(new AccountId.Server(), new AccountId.Player(player), amount, reason)
        .thenApply(
            result ->
                switch (result) {
                  case Result.Ok<Receipt, EconomyError> _ -> Result.ok(formatter.words(amount));
                  case Result.Err<Receipt, EconomyError>(var error) ->
                      Result.err("the bank refused the payment: " + error);
                });
  }

  @Override
  public CompletableFuture<Void> grant(UUID player, String permission) {
    return grants.grant(player, permission);
  }
}
