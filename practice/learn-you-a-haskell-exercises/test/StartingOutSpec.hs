module StartingOutSpec where

import Test.Hspec
import StartingOut

spec :: Spec
spec = do
  describe "penultimate" $ do
    it "should return the first element when there are two elements in the list" $ do
      penultimate [0, 1] `shouldBe` 0
    it "should return the second element when there are three elements in the list" $ do
      penultimate [0, 1, 2] `shouldBe` 1
  describe "findK" $ do
    it "should return the first element when passed zero" $ do
      findK 0 [0, 1] `shouldBe` 0
    it "should return the second element when passed one" $ do
      findK 1 [0, 1] `shouldBe` 1
  describe "isPalindrome" $ do
    it "should return false when a palindrome is not passed" $ do
      isPalindrome "nascar" `shouldBe` False
    it "should return true when a palindrome is passed" $ do
      isPalindrome "tacocat" `shouldBe` True
  describe "duplicate" $ do
    it "should turn a list of a single item into a list of two identical items" $ do
      duplicate [0] `shouldBe` [0, 0]
    it "should turn a list of many items into a list of duplicates items" $ do
      duplicate [0, 1, 2] `shouldBe` [0, 0, 1, 1, 2, 2]
  describe "ziplike" $ do
    it "should return a tuple of the first items of two lists" $ do
      ziplike [0] ['a'] `shouldBe` [(0, 'a')]
  describe "splitAtIndex" $ do
    it "should return a tuple of two lists with one element each when passed a list of two elements" $ do
      splitAtIndex 1 [0, 1] `shouldBe` ([0], [1])
    it "should put the element at k into the second list" $ do
      splitAtIndex 4 [0, 1, 2, 3, 4, 5, 6] `shouldBe` ([0, 1, 2, 3], [4, 5, 6])
  describe "dropK" $ do
    it "should not return the value at the index k" $ do
      dropK 0 [1, 2, 3] `shouldBe` [2, 3]
  describe "slice" $ do
    it "should return only the values between i and k" $ do
      slice 3 6 [0, 0, 0, 1, 2, 3, 0, 0, 0] `shouldBe` [1, 2, 3]
  describe "insertElem" $ do
    it "should return a list with value x at index k" $ do
      insertElem 2 5 [0, 0, 0, 0, 0, 0] `shouldBe` [0, 0, 0, 0, 0, 2, 0]
  describe "rotate" $ do
    it "should return a rotated array" $ do
      rotate 2 [1, 2, 3, 4, 5] `shouldBe` [3, 4, 5, 1, 2]