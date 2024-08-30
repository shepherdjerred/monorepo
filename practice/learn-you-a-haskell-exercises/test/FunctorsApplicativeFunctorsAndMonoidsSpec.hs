module FunctorsApplicativeFunctorsAndMonoidsSpec where

import Test.Hspec
import FunctorsApplicativeFunctorsAndMonoids

spec :: Spec
spec = do
  describe "List" $ do
    it "should implement fmap" $ do
      fmap (+1) (Value 1 Empty) `shouldBe` (Value 2 Empty)
      fmap (+1) (Value 1 (Value 2 Empty)) `shouldBe` (Value 2 (Value 3 Empty))
    it "should implement combineLists" $ do
      combineLists (Value 1 Empty) (Value 2 Empty) `shouldBe` (Value 1 (Value 2 Empty))
      combineLists Empty (Value 1 Empty) `shouldBe` (Value 1 Empty)
      combineLists (Value 1 Empty) Empty `shouldBe` (Value 1 Empty)
      combineLists Empty (Empty :: List ()) `shouldBe` Empty
    it "should be an applicative" $ do
      (Value (+1) (Value (+2) Empty)) <*> (Value 1 Empty) `shouldBe` (Value 2 Empty)
      (Value (+1) Empty) <*> (Value 1 (Value 2 Empty)) `shouldBe` (Value 2 Empty)
    it "should be a monoid" $ do
      mappend (Value 1 Empty) (Value 2 Empty) `shouldBe` (Value 1 (Value 2 Empty))
      mappend (Value 1 (Value 3 Empty)) (Value 2 Empty) `shouldBe` (Value 1 (Value 3 (Value 2 Empty)))
      mappend (Value 1 Empty) mempty `shouldBe` (Value 1 Empty)
      mconcat [(Value 1 Empty), (Value 2 Empty)] `shouldBe` (Value 1 (Value 2 Empty))
      mconcat [Empty, Empty, (Value 1 Empty)] `shouldBe` (Value 1 Empty)
    it "should satisfy the laws of a monad" $ do
      -- Identity
      mempty `mappend` (Value 1 Empty) `shouldBe` (Value 1 Empty)
      mempty `mappend` (Empty :: List ()) `shouldBe` Empty
      (Value 1 Empty) `mappend` mempty `shouldBe` (Value 1 Empty)
      (Empty :: List ()) `mappend` mempty `shouldBe` Empty
      -- Associativity
      ((Value 1 Empty) `mappend` (Value 2 Empty)) `mappend` (Value 3 Empty) `shouldBe` (Value 1 Empty) `mappend` ((Value 2 Empty) `mappend` (Value 3 Empty))
    it "should satisfy the laws of an applicative" $ do
      pure (+1) <*> (Value 1 Empty) `shouldBe` fmap (+1) (Value 1 Empty)
      -- Identity
      pure id <*> (Value 1 Empty) `shouldBe` (Value 1 Empty)
      pure (.) <*> (Value (+ 1) Empty) <*> (Value (+ 2) Empty) <*> (Value 3 Empty) `shouldBe` (Value (+ 1) Empty) <*> ((Value (+ 2) Empty) <*> (Value 3 Empty))
      pure (+1) <*> pure 1 `shouldBe` (pure (1 + 1) :: List Integer)
--      (Value 1 Empty) <*> pure 2 `shouldBe` pure ($ 2) <*> (Value 1 Empty)
    it "should perform the exercises provided" $ do
      (+2) <$> (Value 1 Empty) `shouldBe` (Value 3 Empty)
      (+) <$> (Value 1 (Value 2 Empty)) <*> (Value 1 (Value 2 Empty)) `shouldBe` (Value 2 (Value 4 Empty))
      (Value (+1) (Value (+2) (Value (+3) Empty))) <*> (Value 1 (Value 2 (Value 3 Empty))) `shouldBe` Value 2 (Value 4 (Value 6 Empty))
