module SyntaxInFunctionsSpec where

import Test.Hspec
import Control.Exception (evaluate)
import SyntaxInFunctions

spec :: Spec
spec = do
  describe "englishDigit" $ do
    it "returns expected value for single digits" $ do
      map (englishDigit) [0..9] `shouldBe` ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    it "returns unknown for invalid input" $ do
      englishDigit 10 `shouldBe` "unknown"
  describe "divTuple" $ do
    it "divides valid input correctly" $ do
      divTuple (4, 2) `shouldBe` 2
  describe "threeZeroList" $ do
    it "returns True if the first three elements are zero" $ do
      threeZeroList [0, 0, 0] `shouldBe` True
    it "returns False if the first three elements aren't zero" $ do
      threeZeroList [1, 0, 0] `shouldBe` False