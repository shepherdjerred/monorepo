module HelloRecursionSpec where

import Test.Hspec
import HelloRecursion

spec :: Spec
spec = do
  describe "power" $ do
    it "returns correct answer for 5^2" $ do
      power 5 2 `shouldBe` 25
  describe "fib" $ do
    it "should return [1, 0] for fib 1" $ do
      fib 1 `shouldBe` [1, 0]
    it "should return [55, 34, 21, 13, 8, 5, 3, 2, 1, 1, 0] for fib 10" $ do
      fib 10 `shouldBe` [55, 34, 21, 13, 8, 5, 3, 2, 1, 1, 0]
  describe "stepReverseSign" $ do
    it "should work for a negative number with a positive step" $ do
      stepReverseSign (-3) 1 `shouldBe` 4
    it "should work for a positive number with a negative step" $ do
      stepReverseSign 4 (-2) `shouldBe` -2
    it "should work for a negative number with a negative step" $ do
      stepReverseSign (-7) (-2) `shouldBe` 5
    it "should work for a positive number with a positive step" $ do
      stepReverseSign 1 2 `shouldBe` (-3)
  describe "calcDigits" $ do
    it "should return the number of digits a floating point number is away from zero" $ do
      calcDigits 0.001 `shouldBe` 3
  describe "piCalc" $ do
    it "should return the value of Pi within the given tolerance" $ do
      (piCalc 1) `shouldSatisfy` (\x -> x <= 4 && x >= 2)
      (piCalc 0.1) `shouldSatisfy` (\x -> x <= 3.2 && x >= 3.0)
      (piCalc 0.01) `shouldSatisfy` (\x -> x <= 3.15 && x >= 3.13)
      (piCalc 0.001) `shouldSatisfy` (\x -> x <= 3.142 && x >= 3.140)