package com.shepherdjerred.castlecasters.logic.turn.validator;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

import java.util.ArrayList;
import java.util.List;

@Getter
@ToString
@EqualsAndHashCode
public class TurnValidationResult {

  private final boolean isError;
  private final List<ErrorMessage> errors;

  public TurnValidationResult() {
    this.isError = false;
    this.errors = new ArrayList<>();
  }

  public TurnValidationResult(boolean isError) {
    this.isError = isError;
    this.errors = new ArrayList<>();
  }

  public TurnValidationResult(ErrorMessage error) {
    this.isError = true;
    this.errors = new ArrayList<>();
    errors.add(error);
  }

  public TurnValidationResult(List<ErrorMessage> errors) {
    this.isError = true;
    this.errors = errors;
  }

  private TurnValidationResult(boolean isError, List<ErrorMessage> errors) {
    this.isError = isError;
    this.errors = errors;
  }

  public static TurnValidationResult combine(TurnValidationResult l, TurnValidationResult r) {
    List<ErrorMessage> errors = new ArrayList<>();
    errors.addAll(l.getErrors());
    errors.addAll(r.getErrors());
    return new TurnValidationResult(l.isError || r.isError, errors);
  }

  public enum ErrorMessage {
    NULL,
    COULD_NOT_RUN_VALIDATOR,
    VALIDATOR_FAILED,
    NOT_CAUSERS_TURN,
    MATCH_ALREADY_OVER,
    MOVE_NOT_CARDINAL,
    SOURCE_PIECE_NOT_OWNED_BY_PLAYER,
    SOURCE_PIECE_NOT_PAWN,
    DESTINATION_NOT_EMPTY,
    SOURCE_CELL_TYPE_NOT_PAWN,
    DESTINATION_CELL_TYPE_NOT_PAWN,
    WALL_BETWEEN_SOURCE_AND_DESTINATION,
    MOVE_NOT_ONE_SPACE_AWAY,
    MOVE_NOT_TWO_SPACES_AWAY,
    PLAYER_HAS_NO_WALLS,
    COORDINATES_NOT_WALL_CELLS,
    SOURCE_COORDINATE_INVALID,
    DESTINATION_COORDINATE_INVALID,
    COORDINATES_INVALID,
    MOVE_NOT_DIAGONAL,
    WALL_BLOCKS_PAWN_PATH,
    VERTEX_NOT_FREE,
    VERTEX_COORDINATE_IS_NOT_VERTEX_CELL,
    SOURCE_AND_DESTINATION_NOT_DIFFERENT,
    SOURCE_DIFFERENT_FROM_ACTUAL_LOCATION,
    COORDINATES_NOT_EMPTY,
    PIVOT_NOT_VALID,
    NO_PIECE_AT_PIVOT,
    WALL_BETWEEN_PIVOT_AND_SOURCE,
    WALL_BETWEEN_PIVOT_AND_DESTINATION,
    PIVOT_CELL_TYPE_NOT_PAWN,
    NO_WALL_BEHIND_PIVOT
  }
}
