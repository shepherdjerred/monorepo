module Main where

data Direction = Up | Down | Forward deriving Show
data Command = Command Direction Int deriving Show
data Position = Position { x :: Int, y :: Int, aim :: Int } deriving Show

parseDirection :: String -> Direction
parseDirection s 
  | s == "forward" = Forward
  | s == "down" = Down
  | s == "up" = Up
  | otherwise = undefined

readInt :: String -> Int
readInt s = read s

parseCommand :: [String] -> Command
parseCommand [dir, int] = Command (parseDirection dir) (readInt int)

applyCommand :: Position -> Command -> Position
applyCommand (Position x y aim) (Command Up i) = (Position x y (aim - i))
applyCommand (Position x y aim) (Command Down i) = (Position x y (aim + i))
applyCommand (Position x y aim) (Command Forward i) = (Position (x + i) (y + (aim * i)) aim)

applyCommands :: Position -> [Command] -> Position
applyCommands pos (command:rest) = applyCommands (applyCommand pos command) rest
applyCommands pos [] = pos

main :: IO ()
main = do
  text <- readFile "resources/Day2.txt"
  let ws = fmap words $ lines text
  let commands = fmap parseCommand ws
  let (Position x y _) = applyCommands (Position 0 0 0) commands
  print (x * y)
  