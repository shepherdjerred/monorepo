module Main where

import Data.List

data Bit = Zero | One deriving (Show, Eq)
type Bits = [Bit]

intToBit :: Int -> Bit
intToBit 0 = Zero
intToBit 1 = One
intToBit _ = undefined

bitToInt :: Bit -> Int
bitToInt Zero = 0
bitToInt One = 1

-- Converts a binary number represented as a string into a list of individual digits, e.g. "0100" -> [0, 1, 0, 0]
binaryToListOfBits :: String -> Bits
binaryToListOfBits = map intToBit . (map $ read . (:""))

-- Determines the most frequent bit, e.g. 100 -> 75 -> 1, 100 -> 30 -> 0
mostFrequentBit :: Bit -> Int -> Int -> Bit
mostFrequentBit favoredBit numberOfBits numberOfHighBits
  | numberOfLowBits < numberOfHighBits = One
  | numberOfLowBits > numberOfHighBits = Zero
  | otherwise = favoredBit
  where numberOfLowBits = numberOfBits - numberOfHighBits

leastFrequentBit :: Bit -> Int -> Int -> Bit
leastFrequentBit = ((.) . (.) . (.)) invertBit mostFrequentBit

invertBit :: Bit -> Bit
invertBit Zero = One
invertBit One = Zero

-- Converts a binary number into its decimal representation, e.g. [1, 0, 0] -> 4
binaryToDecimal :: Bits -> Int
binaryToDecimal = binaryToDecimal' 0

binaryToDecimal' :: Int -> Bits -> Int
binaryToDecimal' power [] = 0
binaryToDecimal' power list = 2 ^ power * (bitToInt $ last list) + binaryToDecimal' (power + 1) (init list)

-- Determines if two arrays are equal at a given index
doesMatch :: (Eq a) => Int -> [a] -> [a] -> Bool
doesMatch position left right = left!!position == right!!position

-- Finds all subarrays that match a desired array at a given index
allMatches :: (Eq a) => Int -> [a] -> [[a]] -> [[a]]
allMatches position desired candidates = filter (doesMatch position desired) candidates

closestMatch :: (Int -> Int -> Bit) -> [Bits] -> Bits
closestMatch = closestMatch' 0

closestMatch' :: Int -> (Int -> Int -> Bit) -> [Bits] -> Bits
closestMatch' position fn candidates
  | length currentMatches == 0 = undefined
  | length currentMatches == 1 = head currentMatches
  | otherwise = closestMatch' (position + 1) fn currentMatches
  where currentMatches = allMatches position desired candidates
        desired = fmap (fn $ length candidates) counts
        counts = fmap sum $ fmap (fmap bitToInt) columns
        columns = transpose candidates

main :: IO ()
main = do
  text <- readFile "resources/Day3.txt"
  let values = fmap binaryToListOfBits $ lines text
  let mostCommonBits = fmap (mostFrequentBit undefined (length values)) $ fmap sum $ fmap (fmap bitToInt) $ transpose values
  let gamma = binaryToDecimal mostCommonBits
  let epsilon = binaryToDecimal $ fmap invertBit mostCommonBits
  print $ "Power Consumption: " ++ (show $ gamma * epsilon)
  let ox = binaryToDecimal $ closestMatch (mostFrequentBit One) values
  let co2 = binaryToDecimal $ closestMatch (leastFrequentBit One) values
  print $ "Life Support Rating: " ++ (show $ ox * co2)
