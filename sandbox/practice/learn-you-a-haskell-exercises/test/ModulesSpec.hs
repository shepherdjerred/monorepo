module ModulesSpec where

import Test.Hspec
import Modules
import DistanceConversions

spec :: Spec
spec = do
  describe "areaConv" $ do
    it "correctly applies a function to a value" $ do
      areaConv inchesToCentimetres 9 `shouldBe` 58.0644
  describe "sqInToSqCm" $ do
    it "correctly converts squared inches to squared centimeters" $ do
      sqInToSqCm 9 `shouldBe` 58.0644
  describe "sqChainsToSqM" $ do
    it "correctly converts squared chains to squared meters" $ do
      sqChainsToSqM 1 `shouldBe` 404.68567