package com.shepherdjerred.thestorm.shops.domain.catalog;

/** Why the catalogs, taken together, cannot be loaded. */
public sealed interface CatalogProblem {

  /** Two catalogs share an id. */
  record DuplicateId(String id) implements CatalogProblem {}

  /** A catalog's file name does not match its id. */
  record FileNameMismatch(String fileName, String id) implements CatalogProblem {}

  /** One catalog lists the same item twice. */
  record DuplicateItem(String catalog, String item) implements CatalogProblem {}

  /** No item has this key in the running game. */
  record UnknownItem(String catalog, String item) implements CatalogProblem {}

  /**
   * Some catalog pays more per item than another charges, so players could buy from one and sell to
   * the other forever.
   *
   * @param item the item key
   * @param sellingTo the catalog that pays too much
   * @param buyingFrom the catalog that charges too little
   */
  record Arbitrage(String item, String sellingTo, String buyingFrom) implements CatalogProblem {}

  /** One line for the startup error. */
  default String describe() {
    return switch (this) {
      case DuplicateId(var id) -> "two catalogs use the id " + id;
      case FileNameMismatch(var fileName, var id) ->
          fileName + " must be named " + id + ".yml to match its id";
      case DuplicateItem(var catalog, var item) -> catalog + " lists " + item + " more than once";
      case UnknownItem(var catalog, var item) ->
          catalog + " lists " + item + ", which is not an item";
      case Arbitrage(var item, var sellingTo, var buyingFrom) ->
          sellingTo
              + " pays more per "
              + item
              + " than "
              + buyingFrom
              + " charges; buying there and selling here would print crystals";
    };
  }
}
