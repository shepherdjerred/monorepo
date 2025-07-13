module TypesAndTypeclassesSpec where

import Test.Hspec
import Control.Exception (evaluate)
import TypesAndTypeclasses

spec :: Spec
spec = do
  describe "firstColor" $ do
    it "returns Red" $ do
      firstColor `shouldBe` Red
  describe "reverseColorOrder" $ do
    it "should return colors in reverse order" $ do
      reverseColorOrder `shouldBe` [Violet, Indigo, Blue, Green, Yellow, Orange, Red]