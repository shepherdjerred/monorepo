package com.shepherdjerred.thestorm.shops.domain.trade;

/** Why a trade did not happen. Every variant is an expected refusal, not a bug. */
public sealed interface TradeProblem {

  /** The shop does not trade in this direction. */
  record NotOffered(Direction direction) implements TradeProblem {}

  /** The owner has not chosen the item yet ({@code ?} on the sign). */
  record ItemNotSet() implements TradeProblem {}

  /** Owners cannot trade with their own shop. */
  record OwnShop() implements TradeProblem {}

  /** Another trade with this shop or customer is still settling. */
  record Busy() implements TradeProblem {}

  /** The shop has fewer items than one trade needs. */
  record OutOfStock(int available, int needed) implements TradeProblem {}

  /** The customer's inventory cannot hold the items. */
  record NoRoom(int space, int needed) implements TradeProblem {}

  /** The customer has fewer matching items than one trade needs. */
  record NotEnoughItems(int held, int needed) implements TradeProblem {}

  /** The shop's container cannot hold the items. */
  record ShopFull(int space, int needed) implements TradeProblem {}

  /** The customer cannot afford the price. */
  record CustomerCannotPay(long balance, long required) implements TradeProblem {}

  /** The shop's owner cannot afford to buy. The owner's balance stays private. */
  record OwnerCannotPay() implements TradeProblem {}

  /** The customer has used up today's allowance for this catalog entry. */
  record DailyLimitReached(int remaining, int requested) implements TradeProblem {}
}
