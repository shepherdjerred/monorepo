package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Acrobat;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Alchemist;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Bannerman;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Berserker;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Bleeder;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Decoy;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Demolitions;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Duelist;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Dwarf;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Engineer;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Equality;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Frost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ghost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Grappler;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Inertia;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Juggernaut;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Knight;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Marksman;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ninja;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Quartermaster;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ravager;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Rewind;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Saboteur;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sapper;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Scavenger;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Skinner;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Smokescreen;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Spotter;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Spy;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Tactician;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Tracker;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Vampire;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Venom;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warden;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warper;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Every kit ability, by the id a {@code KitSpec.ability()} names. */
public final class AbilityBook {

  /** Every ability this module implements. */
  public static final List<Ability> ALL =
      List.of(
          new Rewind(),
          new Ninja(),
          new Venom(),
          new Juggernaut(),
          new Berserker(),
          new Equality(),
          new Vampire(),
          new Bleeder(),
          new Medic(),
          new Frost(),
          new Warper(),
          new Teleporter(),
          new Demolitions(),
          new Explosive(),
          new Ghost(),
          new Wraith(),
          new Spy(),
          new Skinner(),
          new Dwarf(),
          new Sacrificial(),
          new Inertia(),
          new Sapper(),
          new Saboteur(),
          new Spotter(),
          new Grappler(),
          new Bannerman(),
          new Engineer(),
          new Tracker(),
          new Decoy(),
          new Duelist(),
          new Knight(),
          new Ravager(),
          new Acrobat(),
          new Alchemist(),
          new Scavenger(),
          new Marksman(),
          new Quartermaster(),
          new Warden(),
          new Smokescreen(),
          new Tactician());

  private static final Map<String, Ability> BY_ID =
      ALL.stream().collect(Collectors.toUnmodifiableMap(Ability::id, Function.identity()));

  private AbilityBook() {}

  /** The ability {@code id}, if it is implemented here. */
  public static Optional<Ability> byId(String id) {
    return Optional.ofNullable(BY_ID.get(id));
  }
}
