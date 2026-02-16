package com.shepherdjerred.castlecasters.common.lobby;

import com.shepherdjerred.castlecasters.common.GameMap;
import com.shepherdjerred.castlecasters.common.lobby.LobbySettings.LobbyType;
import com.shepherdjerred.castlecasters.common.player.AiPlayer;
import com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty;
import com.shepherdjerred.castlecasters.common.player.Element;
import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;
import org.ajbrown.namemachine.NameGenerator;

import java.util.Optional;
import java.util.UUID;

@ToString
@EqualsAndHashCode
public class Lobby {

  @Getter
  private final UUID uuid;
  @Getter
  private final LobbySettings lobbySettings;
  private final PlayerSlots playerSlots;
  private final ElementCounts elementCounts;

  private Lobby(UUID uuid,
                LobbySettings lobbySettings,
                PlayerSlots playerSlots,
                ElementCounts elementCounts) {
    this.lobbySettings = lobbySettings;
    this.playerSlots = playerSlots;
    this.elementCounts = elementCounts;
    this.uuid = uuid;
  }

  public static Lobby fromDefaultLobbySettings(String lobbyName) {
    var lobbySettings = new LobbySettings(lobbyName,
        new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO),
        LobbyType.LOCAL,
        false,
        GameMap.GRASS);
    return from(lobbySettings);
  }

  public static Lobby from(LobbySettings lobbySettings) {
    var playerCount = lobbySettings.matchSettings().playerCount();
    var playerSlots = PlayerSlots.forPlayerCount(playerCount);
    var elementCounts = new ElementCounts();
    return new Lobby(UUID.randomUUID(), lobbySettings, playerSlots, elementCounts);
  }

  public Lobby setLobbySettings(LobbySettings lobbySettings) {
    // TODO this won't work when resizing player slots
    return new Lobby(uuid, lobbySettings, this.playerSlots, this.elementCounts);
  }

  public boolean isReady() {
    var sameElement = lobbySettings.isDuplicateElementsEnabled();
    if (sameElement) {
      return areElementsUnique() && isFull();
    } else {
      return isFull();
    }
  }

  public AiPlayer createAiPlayer() {
    var generator = new NameGenerator();
    return new AiPlayer(UUID.randomUUID(),
        generator.generateName().getFirstName(),
        getFreeElement().get(),
        Difficulty.HARD);
  }

  public QuoridorPlayer getPlayer(Player player) {
    return playerSlots.getPlayerIdByPlayer(player);
  }

  public Player getPlayer(QuoridorPlayer player) {
    return playerSlots.getPlayer(player);
  }

  public Optional<Element> getFreeElement() {
    return elementCounts.getNextFreeElement();
  }

  public boolean areElementsUnique() {
    return elementCounts.areUnique();
  }

  public boolean isFull() {
    return playerSlots.areSlotsFull();
  }

  public boolean hasFreeSlot() {
    return !isFull();
  }

  public Lobby addPlayer(Player player) {
    var newPlayerSlots = playerSlots.addPlayer(player);
    var newElementCounts = elementCounts.increment(player.element());
    return new Lobby(uuid, lobbySettings, newPlayerSlots, newElementCounts);
  }

  public Lobby setPlayer(Player player, QuoridorPlayer quoridorPlayer) {
    var newPlayerSlots = playerSlots.setPlayer(quoridorPlayer, player);
    return new Lobby(uuid, lobbySettings, newPlayerSlots, elementCounts);
  }

  public Lobby updatePlayer(QuoridorPlayer playerId, Player newPlayer) {
    var oldPlayer = playerSlots.getPlayer(playerId);
    var newElementCounts = elementCounts;
    if (oldPlayer.element() != newPlayer.element()) {
      newElementCounts = newElementCounts.decrement(oldPlayer.element());
      newElementCounts = newElementCounts.increment(newPlayer.element());
    }
    var newPlayerSlots = playerSlots.setPlayer(playerId, newPlayer);
    return new Lobby(uuid, lobbySettings, newPlayerSlots, newElementCounts);
  }

  public Lobby removePlayer(QuoridorPlayer playerId) {
    var player = playerSlots.getPlayer(playerId);
    var newPlayerSlots = playerSlots.removePlayer(playerId);
    var newElementCounts = elementCounts.decrement(player.element());
    return new Lobby(uuid, lobbySettings, newPlayerSlots, newElementCounts);
  }

  public Lobby removePlayer(Player player) {
    return removePlayer(playerSlots.getPlayerIdByPlayer(player));
  }

  public int getFreeSlots() {
    return playerSlots.getFreeSlots();
  }

  public int getTakenSlots() {
    return playerSlots.getTakenSlots();
  }

  public int getMaxSlots() {
    return playerSlots.getMaxSlots();
  }
}
