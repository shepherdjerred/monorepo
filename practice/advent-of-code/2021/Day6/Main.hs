module Main where
-- Heavily inspired by https://www.reddit.com/r/haskell/comments/r9z4qb/advent_of_code_2021_day_06/

import Data.MultiSet (MultiSet, size, fromList, concatMap)
import Data.List.Split

simulate :: MultiSet Int -> MultiSet Int
simulate = Data.MultiSet.concatMap (\x -> if x == 0 then [6, 8] else [x - 1])

parse :: String -> [Int]
parse input = fmap read $ splitOn "," input

main :: IO ()
main = do
    text <- readFile "resources/Day6.txt"
    let fish = parse text
    let set = fromList fish
    print $ size $ (iterate simulate set)!!256
