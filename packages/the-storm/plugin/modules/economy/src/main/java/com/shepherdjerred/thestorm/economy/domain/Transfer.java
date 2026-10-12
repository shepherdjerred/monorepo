package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Money;

/**
 * A request to move money of one currency between two accounts, before any rule has looked at it.
 *
 * @param from the paying account
 * @param to the receiving account
 * @param amount what should move, and in which currency
 */
public record Transfer(AccountId from, AccountId to, Money amount) {}
