package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;

/**
 * A request to move crystals between two accounts, before any rule has looked at it.
 *
 * @param from the paying account
 * @param to the receiving account
 * @param amount what should move
 */
public record Transfer(AccountId from, AccountId to, Crystals amount) {}
