module FunctorsApplicativeFunctorsAndMonoids(List(..), combineLists) where
import Control.Applicative
import Data.Monoid

-- We can use the following type to simulate our own list
data List a = Empty | Value a (List a) deriving (Eq, Show)

-- Make the list a Functor
instance Functor List where
  fmap f Empty = Empty
  fmap f (Value a rest) = Value (f a) (fmap f rest)

-- Write a function which appends one list on to another
combineLists :: List a -> List a -> List a
combineLists (Value a rest) b = Value a (combineLists rest b)
combineLists Empty b = b

-- Make our list as a Monoid
instance Monoid (List a) where
  mempty = Empty
  mappend = combineLists

instance Semigroup (List a) where
  (<>) = undefined

-- Make our list an Applicative
instance Applicative List where
  pure a = (Value a Empty)
  Empty <*> a = Empty
  a <*> Empty = Empty
  (Value f restF) <*> (Value x restX) = (Value (f x) (restF <*> restX))
