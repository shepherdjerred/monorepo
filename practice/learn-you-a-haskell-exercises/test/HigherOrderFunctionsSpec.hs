module HigherOrderFunctionsSpec where

import Test.Hspec
import HigherOrderFunctions

spec :: Spec
spec = do
  describe "sumInts" $ do
    it "returns the sum of a range of integers" $ do
      sumInts 0 1 `shouldBe` 1
      sumInts 1 3 `shouldBe` 6
  describe "sq" $ do
    it "returns the square of a number" $ do
      sq 2 `shouldBe` 4
      sq 4 `shouldBe` 16
  describe "sumSquares" $ do
    it "should return the sum of the squares of two numbers, inclusive" $ do
      sumSquares 0 1 `shouldBe` 0 + 1
      sumSquares 1 2 `shouldBe` 1 + 4
      sumSquares 3 5 `shouldBe` 9 + 16 + 25
  describe "higherOrderSum" $ do
    it "should correctly apply a given function" $ do
      higherOrderSum sq 0 1  `shouldBe` 0 + 1
      higherOrderSum sq 1 2  `shouldBe` 1 + 4
      higherOrderSum sq 3 5  `shouldBe` 9 + 16 + 25
  describe "hoSumSquares" $ do
    it "should return the sum of squares" $ do
      hoSumSquares 0 1 `shouldBe` 0 + 1
      hoSumSquares 1 2 `shouldBe` 1 + 4
      hoSumSquares 3 5 `shouldBe` 9 + 16 + 25
  describe "hoSumInts" $ do
    it "should return the sum of ints" $ do
      hoSumInts 0 1 `shouldBe` 1
      hoSumInts 1 3 `shouldBe` 6
  describe "factorial" $ do
    it "should return the factorial of the input" $ do
      factorial 0 `shouldBe` 1
      factorial 1 `shouldBe` 1
      factorial 2 `shouldBe` 2
      factorial 8 `shouldBe` 40320
  describe "hoFactorial" $ do
    it "should return the summed factorial within a range of numbers, inclusive" $ do
      hoFactorial 0 1 `shouldBe` 2
      hoFactorial 0 2 `shouldBe` 4
      hoFactorial 0 3 `shouldBe` 10