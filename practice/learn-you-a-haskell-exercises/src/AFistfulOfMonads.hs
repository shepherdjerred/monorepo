module AFistfulOfMonads(Validation(..), positiveCheck, positiveAndEvenCheck, evenCheck) where
{-
 - Create a type called Validation
 - The type constructor takes one parameter
 - There are two Values: 
 -   Success, which takes that parameter and
 -   Fail String, which represents a failure, and a reason for that failure
 -}
data Validation a = Success a | Fail String deriving (Eq, Show)

-- Make the Validation a Monad
instance Monad Validation where
  return = Success
  Fail msg >>= f = Fail msg
  Success a >>= f = f a

instance Applicative Validation where
  pure a = Success a
  (Fail a) <*> _ = Fail a
  _ <*> (Fail a) = Fail a
  (Success f) <*> (Success b) = (Success (f b))

instance Functor Validation where
  fmap _ (Fail a) = Fail a
  fmap f (Success a) = Success (f a)

{-
 - Create a function, positiveCheck, which takes a number and returns a successful Validation if it's positive, 
 - and a failed Validation with a String message if not.
 -}
positiveCheck :: (Num a, Ord a, Show a) => a -> Validation a
positiveCheck x
  | x >= 0 = Success x
  | otherwise = Fail ((show x) ++ " is not positive")

{-
 - Create a function, evenCheck, which returns a successful Validation if it's even,
 - and a failed Validation with a string message if it's odd
 -}
evenCheck :: (Integral a, Show a)  =>  a -> Validation a
evenCheck x
  | x `mod` 2 == 0 = Success x
  | otherwise = Fail ((show x) ++ " is not even")

{-
 - Write a function which uses positiveCheck and evenCheck to make sure a number is both positive and even
 -}
positiveAndEvenCheck :: (Num a, Ord a, Integral a, Show a) => a -> Validation a
positiveAndEvenCheck a = return a >>= positiveCheck >>= evenCheck
