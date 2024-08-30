module Main where

import Data.List.Split
import Debug.Trace
import Data.List

parse :: String -> [Int]
parse input = fmap read $ splitOn "," input

absolute :: Int -> Int
absolute i
  | i > 0 = i
  | otherwise = -i

-- Finds the median of a sorted list
median :: [Int] -> Int
median nums
  | odd = nums!!midpoint
  | otherwise = ((nums!!midpoint) + (nums!!(midpoint - 1))) `div` 2
  where len = length nums
        odd = len `mod` 2 == 1
        midpoint = len `div` 2

distance :: Int -> Int -> Int
distance median number = absolute(median - number)

weightedDistance :: Int -> Int -> Int
weightedDistance left right = ((distance ^ 2) + distance) `div` 2
  where distance = absolute(left - right)

-- Scores a position
score :: [Int] -> Int -> Int
score nums position = sum $ fmap (weightedDistance position) nums

-- I was gonna write a binary search, but brute forcing worked!
-- Takes a list of crabs and returns the fuel cost to obtain the best position
naïve :: [Int] -> Int
naïve nums = head $ sort $ fmap (score nums) uniquePositions
  where uniquePositions = [(head nums)..(last nums)]

main :: IO ()
main = do
  text <- readFile "resources/Day7.txt"
  let crabs = sort $ parse text
  print $ naïve crabs
