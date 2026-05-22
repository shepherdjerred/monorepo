package com.shepherdjerred.castlecasters.logic.board;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

public class CoordinateTest {

  @Disabled
  @Test
  public void constructor_ThrowsException_WhenGivenNegativeX() {
    Assertions.assertThrows(IllegalArgumentException.class, () -> new Coordinate(-1, 0));
  }

  @Disabled
  @Test
  public void constructor_ThrowsException_WhenGivenNegativeY() {
    Assertions.assertThrows(IllegalArgumentException.class, () -> new Coordinate(0, -1));
  }

  @Test
  public void fromOffset_ReturnsCoordinateWithOffsetX_WhenXIsPositive() {
    var coordinate = new Coordinate(0, 0);
    var expected = new Coordinate(10, 0);
    var actual = coordinate.fromOffset(10, 0);
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void fromOffset_ReturnsCoordinateWithOffsetY_WhenYIsPositive() {
    var coordinate = new Coordinate(0, 0);
    var expected = new Coordinate(0, 10);
    var actual = coordinate.fromOffset(0, 10);
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void fromOffset_ReturnsCoordinateWithOffsetXAndY_WhenXAndYArePositive() {
    var coordinate = new Coordinate(0, 0);
    var expected = new Coordinate(10, 10);
    var actual = coordinate.fromOffset(10, 10);
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void fromOffset_ReturnsEqualCoordinate_WhenXAndYAreZero() {
    var coordinate = new Coordinate(0, 0);
    var actual = coordinate.fromOffset(0, 0);
    Assertions.assertEquals(coordinate, actual);
  }

  @Test
  public void left_ReturnsCoordinateWithXDecremented_WhenCalledWithNoArgument() {
    var coordinate = new Coordinate(5, 0);
    var expected = new Coordinate(4, 0);
    var actual = coordinate.toLeft();
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void right_ReturnsCoordinateWithXIncremented_WhenCalledWithNoArgument() {
    var coordinate = new Coordinate(5, 0);
    var expected = new Coordinate(6, 0);
    var actual = coordinate.toRight();
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void above_ReturnsCoordinateWithYIncremented_WhenCalledWithNoArgument() {
    var coordinate = new Coordinate(0, 5);
    var expected = new Coordinate(0, 6);
    var actual = coordinate.above();
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void below_ReturnsCoordinateWithYDecremented_WhenCalledWithNoArgument() {
    var coordinate = new Coordinate(0, 5);
    var expected = new Coordinate(0, 4);
    var actual = coordinate.below();
    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void isAdjacent_ReturnsTrue_WhenCalledWithCoordinateOneAbove() {
    var c1 = new Coordinate(0, 5);
    var c2 = new Coordinate(0, 6);
    Assertions.assertTrue(c1.isAdjacent(c2));
  }

  @Test
  public void isAdjacent_ReturnsTrue_WhenCalledWithCoordinateOneBelow() {
    var c1 = new Coordinate(0, 5);
    var c2 = new Coordinate(0, 4);
    Assertions.assertTrue(c1.isAdjacent(c2));
  }

  @Test
  public void isAdjacent_ReturnsTrue_WhenCalledWithCoordinateOneToTheLeft() {
    var c1 = new Coordinate(5, 0);
    var c2 = new Coordinate(4, 0);
    Assertions.assertTrue(c1.isAdjacent(c2));
  }

  @Test
  public void isAdjacent_ReturnsTrue_WhenCalledWithCoordinateOneToTheRight() {
    var c1 = new Coordinate(5, 0);
    var c2 = new Coordinate(6, 0);
    Assertions.assertTrue(c1.isAdjacent(c2));
  }

  @Test
  public void isAdjacent_ReturnsFalse_WhenCalledWithDiagonallyAdjacentCoordinate() {
    var origin = new Coordinate(5, 5);
    var topLeft = new Coordinate(4, 6);
    var topRight = new Coordinate(6, 6);
    var bottomLeft = new Coordinate(4, 4);
    var bottomRight = new Coordinate(6, 4);

    Assertions.assertFalse(origin.isAdjacent(topLeft));
    Assertions.assertFalse(origin.isAdjacent(topRight));
    Assertions.assertFalse(origin.isAdjacent(bottomLeft));
    Assertions.assertFalse(origin.isAdjacent(bottomRight));
  }

  @Test
  public void isAdjacent_ReturnsFalse_WhenCalledWithCoordinateTwoAway() {
    var origin = new Coordinate(5, 5);
    var twoLeft = new Coordinate(3, 5);
    var twoRight = new Coordinate(7, 5);
    var twoAbove = new Coordinate(5, 7);
    var twoBelow = new Coordinate(5, 3);

    Assertions.assertFalse(origin.isAdjacent(twoLeft));
    Assertions.assertFalse(origin.isAdjacent(twoRight));
    Assertions.assertFalse(origin.isAdjacent(twoAbove));
    Assertions.assertFalse(origin.isAdjacent(twoBelow));
  }

  @Test
  public void areCoordinatesCardinal_ReturnsTrue_WhenCalledWithCardinalCoordinates() {
    var origin = new Coordinate(5, 5);
    var oneLeft = new Coordinate(4, 5);
    var twoLeft = new Coordinate(3, 5);
    var oneRight = new Coordinate(6, 5);
    var twoRight = new Coordinate(7, 5);
    var oneAbove = new Coordinate(5, 6);
    var twoAbove = new Coordinate(5, 7);
    var oneBelow = new Coordinate(5, 4);
    var twoBelow = new Coordinate(5, 3);

    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, oneLeft));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, twoLeft));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, oneRight));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, twoRight));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, oneAbove));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, twoAbove));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, oneBelow));
    Assertions.assertTrue(Coordinate.areCoordinatesCardinal(origin, twoBelow));
  }

  @Test
  public void areCoordinatesCardinal_ReturnsFalse_WhenCalledWithDiagonalCoordinates() {
    var origin = new Coordinate(5, 5);
    var topLeft = new Coordinate(4, 6);
    var topRight = new Coordinate(6, 6);
    var bottomLeft = new Coordinate(4, 4);
    var bottomRight = new Coordinate(6, 4);

    var c1 = new Coordinate(10, 10);
    var c2 = new Coordinate(6, 10);

    Assertions.assertFalse(Coordinate.areCoordinatesCardinal(origin, topLeft));
    Assertions.assertFalse(Coordinate.areCoordinatesCardinal(origin, topRight));
    Assertions.assertFalse(Coordinate.areCoordinatesCardinal(origin, bottomLeft));
    Assertions.assertFalse(Coordinate.areCoordinatesCardinal(origin, bottomRight));
    Assertions.assertFalse(Coordinate.areCoordinatesCardinal(origin, c1));
    Assertions.assertFalse(Coordinate.areCoordinatesCardinal(origin, c2));
  }

  @Test
  public void areCoordinatesDiagonal_ReturnsTrue_WhenCalledWithDiagonalCoordinates() {
    var origin = new Coordinate(5, 5);
    var topLeft = new Coordinate(4, 6);
    var topRight = new Coordinate(6, 6);
    var bottomLeft = new Coordinate(4, 4);
    var bottomRight = new Coordinate(6, 4);

    var c1 = new Coordinate(10, 10);
    var c2 = new Coordinate(6, 10);

    Assertions.assertTrue(Coordinate.areCoordinatesDiagonal(origin, topLeft));
    Assertions.assertTrue(Coordinate.areCoordinatesDiagonal(origin, topRight));
    Assertions.assertTrue(Coordinate.areCoordinatesDiagonal(origin, bottomLeft));
    Assertions.assertTrue(Coordinate.areCoordinatesDiagonal(origin, bottomRight));
    Assertions.assertTrue(Coordinate.areCoordinatesDiagonal(origin, c1));
    Assertions.assertTrue(Coordinate.areCoordinatesDiagonal(origin, c2));
  }

  @Test
  public void areCoordinatesDiagonal_ReturnsFalse_WhenCalledWithCardinalCoordinates() {
    var origin = new Coordinate(5, 5);
    var oneLeft = new Coordinate(4, 5);
    var twoLeft = new Coordinate(3, 5);
    var oneRight = new Coordinate(6, 5);
    var twoRight = new Coordinate(7, 5);
    var oneAbove = new Coordinate(5, 6);
    var twoAbove = new Coordinate(5, 7);
    var oneBelow = new Coordinate(5, 4);
    var twoBelow = new Coordinate(5, 3);

    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, oneLeft));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, twoLeft));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, oneRight));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, twoRight));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, oneAbove));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, twoAbove));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, oneBelow));
    Assertions.assertFalse(Coordinate.areCoordinatesDiagonal(origin, twoBelow));
  }

  @Test
  public void calculateMidpoint_ReturnsMidpoint_WhenCalledWithCardinalPoints() {
    var c1 = new Coordinate(5, 5);
    var c2 = new Coordinate(5, 7);
    var expected = new Coordinate(5, 6);

    Assertions.assertEquals(expected, Coordinate.calculateMidpoint(c1, c2));
  }

  @Test
  public void calculateMidpoint_ThrowsException_WhenCalledWithDiagonalPoints() {
    var c1 = new Coordinate(5, 5);
    var c2 = new Coordinate(6, 6);

    Assertions.assertThrows(IllegalArgumentException.class, () -> Coordinate.calculateMidpoint(c1, c2));
  }

  @Test
  public void calculateManhattanDistance_ReturnsManhattanDistance_WhenCalledWithCardinalPoints() {
    var c1 = new Coordinate(5, 5);
    var c2 = new Coordinate(5, 6);
    var c3 = new Coordinate(5, 7);

    Assertions.assertEquals(1, Coordinate.calculateManhattanDistance(c1, c2));
    Assertions.assertEquals(2, Coordinate.calculateManhattanDistance(c1, c3));
  }

  @Test
  public void calculateManhattanDistance_ReturnsManhattanDistance_WhenCalledWithDiagonalPoints() {
    var c1 = new Coordinate(5, 5);
    var c2 = new Coordinate(6, 6);
    var c3 = new Coordinate(7, 7);

    Assertions.assertEquals(2, Coordinate.calculateManhattanDistance(c1, c2));
    Assertions.assertEquals(4, Coordinate.calculateManhattanDistance(c1, c3));
  }
}
