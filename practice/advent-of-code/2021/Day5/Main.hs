module Main where

import Data.List
import Data.List.Split
import Debug.Trace
import qualified Data.Map as Map

data Point = Point { x :: Int, y :: Int } deriving (Show, Eq, Ord)
type Line = (Point, Point)
type PointMap = Map.Map Point Int

swap :: Line -> Line
swap line
  | x1 > x2 = ((Point x2 y2), (Point x1 y1))
  | y1 > y2 && x1 == x2 = ((Point x2 y2), (Point x1 y1))
  | otherwise = line
  where ((Point x1 y1), (Point x2 y2)) = line

toPoints :: Line -> [Point]
toPoints line
  | x1 == x2 = [ (Point x1 y) | y <- [y1..y2] ]
  | y1 == y2 = [ (Point x y1) | x <- [x1..x2] ]
  | otherwise = trace (show line) toPointsDiag line
  where ((Point x1 y1), (Point x2 y2)) = line

-- There's definitely a more elegant way to solve this, but I've been stuck on this problem for a bit and just want to be done with it.
toPointsDiag :: Line -> [Point]
toPointsDiag line
  | x1 == x2 && y1 == y2 = [fst line]
  | isDown = [(Point x1 y1)] ++ (toPointsDiag ((Point (x1 + 1) (y1 - 1), Point x2 y2)))
  | otherwise = [(Point x1 y1)] ++ (toPointsDiag ((Point (x1 + 1) (y1 + 1), Point x2 y2)))
  where ((Point x1 y1), (Point x2 y2)) = line
        isDown = y1 > y2

currentCount :: Point -> PointMap -> Int
currentCount point map = Map.findWithDefault 0 point map

toMap :: [Point] -> PointMap
toMap points = toMap' points Map.empty

toMap' :: [Point] -> PointMap -> PointMap
toMap' [] map = map
toMap' (head:rest) map = toMap' rest $ Map.insert head ((currentCount head map) + 1) map

intersections :: PointMap -> PointMap
intersections map = Map.filter (>= 2) map

readInt :: String -> Int
readInt = read

parsePoint :: String -> Point
parsePoint input = Point (head coords) (last coords)
    where coords = fmap readInt $ splitOn "," input

parseLine :: String -> Line
parseLine input = ((head points), (last points))
    where points = fmap (parsePoint) $ splitOn "->" input

parse :: [String] -> [Line]
parse = fmap parseLine

main :: IO ()
main = do
    text <- readFile "resources/Day5.txt"
    let input = parse $ lines text
    let points = concat $ fmap toPoints $ fmap swap input
    let map = toMap points
    let count = length $ intersections map 
    print (show count)
