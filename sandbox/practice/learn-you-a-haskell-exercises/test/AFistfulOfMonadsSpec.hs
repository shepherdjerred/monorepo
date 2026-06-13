module AFistfulOfMonadsSpec where

import Test.Hspec
import AFistfulOfMonads

spec :: Spec
spec = do
  describe "Validation" $ do
    it "should do stuff" $ do
      (Success 1 >>= \x -> return (x + 1)) `shouldBe` Success 2
      (Fail "Something failed!" >>= \x -> return (x + 1)) `shouldBe` Fail "Something failed!"
  describe "positiveCheck" $ do
    it "should return Success for positive numbers" $ do
      positiveCheck 5 `shouldBe` Success 5
    it "should return Fail for negative numbers" $ do
      positiveCheck (-5) `shouldBe` Fail "-5 is not positive"
  describe "evenCheck" $ do
    it "should return Success for even numbers" $ do
      evenCheck 4 `shouldBe` Success 4
    it "should return Fail for odd numbers" $ do
      evenCheck 5 `shouldBe` Fail "5 is not even"
  describe "positiveAndEvenCheck" $ do
    it "should return Success for even and positive numbers" $ do
      positiveAndEvenCheck 6 `shouldBe` Success 6
    it "should return Fail for even and negative numbers" $ do
      positiveAndEvenCheck (-6) `shouldBe` Fail "-6 is not positive"
    it "should return Fail for odd and positive numbers" $ do
      positiveAndEvenCheck 5 `shouldBe` Fail "5 is not even"
    it "should return Fail for odd and negative numbers" $ do
      positiveAndEvenCheck (-5) `shouldBe` Fail "-5 is not positive"
        