module MakingOurOwnTypesAndTypeclassesSpec where

import Test.Hspec
import Modules
import MakingOurOwnTypesAndTypeclasses

spec :: Spec
spec = do
  describe "Card" $ do
    it "should show in the expected format" $ do
      show (Card Ace Spades) `shouldBe` "The Ace of Spades"
  describe "betterCard" $ do
    it "should correctly order cards" $ do
      betterCard (Card Ace Spades) (Card King Spades) `shouldBe` (Card Ace Spades)
      betterCard (Card Two Clubs) (Card Three Clubs) `shouldBe` (Card Two Clubs)
  describe "play" $ do
    it "should return true when a list of cards has the Ace of Spades" $ do
      play [(Card Ace Spades)] `shouldBe` True
    it "should return false when a list of cards doesn't have the Ace of Spades" $ do
      play [(Card Two Clubs)] `shouldBe` False
    it "should return true when a list has ten consecutive Heads" $ do
      play (replicate 10 Heads) `shouldBe` True
      play ([Tails] ++ (replicate 10 Heads) ++ [Tails]) `shouldBe` True
    it "should return false when a list doesn't have ten consecutive Heads" $ do
      play (replicate 9 Heads) `shouldBe` False
      play [Tails] `shouldBe` False