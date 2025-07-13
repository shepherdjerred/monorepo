module InputAndOutputSpec where

import Test.Hspec
import Modules
import InputAndOutput
import System.Random

spec :: Spec
spec = do
-- I'm not really sure how to test this effectively because the echo function relies on command line arguments/STDOUT.
-- Unit tests might come later...
  describe "echo" $ do
    it "should print the string passed" $ do
      echo
  describe "lottery" $ do
    it "should return a list of six numbers" $ do
      lottery (mkStdGen 100) `shouldBe` [39, 9, 25, 29, 42, 15]
