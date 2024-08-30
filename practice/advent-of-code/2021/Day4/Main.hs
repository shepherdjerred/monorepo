module Main where
-- Some of this solution was inspired by Bartosz Milewski's solution
-- See: https://github.com/BartoszMilewski/AoC2021/blob/main/Day4.hs

import Data.List
import Data.List.Split

data Spot = Spot { num :: Int, called :: Bool } deriving (Show, Eq)
type Answers = [Int]
type Row = [Spot]
type Board = [Row]
type Boards = [Board]
data Input = Input { answers :: Answers, boards :: Boards } deriving (Show)

readInt :: String -> Int
readInt = read

readSpot :: String -> Spot
readSpot value = Spot (readInt value) False

parseAnswers :: String -> Answers
parseAnswers = fmap readInt . (splitOn ",")

parseBoards :: [String] -> Boards
parseBoards = fmap (fmap (fmap readSpot) . fmap words) . (splitWhen null)

parseInput :: [String] -> Input
parseInput (first : _ : rest) = Input (parseAnswers first) (parseBoards rest)

checkBoard :: Board -> Bool
checkBoard board = (checkBoardHorizontal board) || (checkBoardVertical board)

checkBoardHorizontal :: Board -> Bool
checkBoardHorizontal = any $ all called

checkBoardVertical :: Board -> Bool
checkBoardVertical = checkBoardHorizontal . transpose

applyAnswerToSpot :: Int -> Spot -> Spot
applyAnswerToSpot answer (Spot num called)
  | answer == num = Spot num True
  | answer /= num = Spot num called

applyAnswerToRow :: Int -> Row -> Row
applyAnswerToRow answer row = fmap (applyAnswerToSpot answer) row

applyAnswer :: Int -> Board -> Board
applyAnswer answer board = fmap (applyAnswerToRow answer) board

firstWinningBoard :: Answers -> Boards -> (Int, Board)
firstWinningBoard answers boards
  | numberOfCompletedBoards > 1 = undefined
  | numberOfCompletedBoards < 1 = firstWinningBoard (tail answers) boardsAfterAnswerApplied
  | numberOfCompletedBoards == 1 = ((head answers), (head completedBoards))
  where numberOfCompletedBoards = length completedBoards
        completedBoards = filter checkBoard boardsAfterAnswerApplied
        boardsAfterAnswerApplied = fmap (applyAnswer $ head answers) boards

lastWinningBoard :: Answers -> Boards -> (Int, Board)
lastWinningBoard answers boards
  | ((length boardsAfterAnswerApplied) == 1) && (checkBoard (head boardsAfterAnswerApplied)) = ((head answers), (head boardsAfterAnswerApplied))
  | otherwise = lastWinningBoard (tail answers) boardsThatHaventWon
  where boardsAfterAnswerApplied = fmap (applyAnswer $ head answers) boards
        boardsThatHaventWon = filter (not . checkBoard) boardsAfterAnswerApplied

uncalledNumbers :: Board -> [Int]
uncalledNumbers = fmap num . filter (not . called) . concat

main :: IO ()
main = do
    text <- readFile "resources/Day4.txt"
    let words = lines text
    let input = parseInput words
    let (answer, board) = firstWinningBoard (answers input) (boards input)
    let uncalledNumbersSum = sum $ uncalledNumbers board
    print $ answer * uncalledNumbersSum
    let (lastAnswer, lastBoard) = lastWinningBoard (answers input) (boards input)
    let uncalledLastNumbersSum = sum $ uncalledNumbers lastBoard
    print $ lastAnswer * uncalledLastNumbersSum
