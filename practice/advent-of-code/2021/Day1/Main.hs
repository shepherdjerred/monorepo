module Main where

listToSumWindow :: Int -> [Int] -> [Int]
listToSumWindow windowSize list
  | (length list) > windowSize = (listToSumWindow windowSize (take windowSize list)) ++ (listToSumWindow windowSize (tail list))
  | (length list) == windowSize = [sum list]
  | otherwise = []

didIncrease :: Int -> Int -> Int
didIncrease prev current
  | current > prev = 1
  | otherwise = 0

countIncreases :: [Int] -> Int
countIncreases (x:y:rest) = (didIncrease x y) + (countIncreases ([y] ++ rest))
countIncreases [x] = 0
countIncreases [] = 0

readInt :: String -> Int
readInt s = read s

main :: IO ()
main = do
  text <- readFile "resources/Day1.txt"
  let xs = fmap readInt $ lines text
  print (countIncreases (listToSumWindow 3 xs))
  