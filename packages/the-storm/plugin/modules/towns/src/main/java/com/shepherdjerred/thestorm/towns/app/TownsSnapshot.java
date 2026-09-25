package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.List;

/**
 * Everything stored, as loaded at enable.
 *
 * @param towns every town with its members
 * @param claims every claim with its flags
 */
public record TownsSnapshot(List<Town> towns, List<Claim> claims) {

  public TownsSnapshot {
    towns = List.copyOf(towns);
    claims = List.copyOf(claims);
  }
}
