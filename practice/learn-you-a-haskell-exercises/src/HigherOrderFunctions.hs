module HigherOrderFunctions (sumInts, sq, sumSquares, higherOrderSum, hoSumSquares, hoSumInts, higherOrderSequenceApplication, hoFactorial, factorial) where
-- Sum the numbers between two inclusive values recursively, assuming a < b when the function is first called
-- Example: sumInts 0 1 = 1
--          sumInts 1 3 = 6
sumInts :: Int -> Int -> Int
sumInts a b
  | b < a = error "b cannot be less than a"
  | a == b = a
  | otherwise = a + (sumInts (a + 1) b)

-- Define a square function
sq :: Int -> Int
sq x = x * x

-- Sum the squares between two numbers. This function should be similar to the sumInts function
sumSquares :: Int -> Int -> Int
sumSquares a b
  | b < a = error "b cannot be less than a"
  | a == b = sq a
  | otherwise = sq a + (sumSquares (a + 1) b)

-- Define a higher order sum function which accepts an (Int -> Int) function to apply to all integers between two values.
-- Again this should look similar to the sumInts and sumSquares functions
higherOrderSum :: (Int -> Int) -> Int -> Int -> Int
higherOrderSum intApplication a b
  | b < a = error "b cannot be less than a"
  | a == b = intApplication a
  | otherwise = intApplication a + (higherOrderSum intApplication (a + 1) b)

-- Define the square sum in terms of higherOrderSum
hoSumSquares :: Int -> Int -> Int
hoSumSquares a b = higherOrderSum sq a b

-- Define the sum between two values in terms of higherOrderSum
-- Note there is no parameter on the function definition
-- Try to use a lambda if possible
hoSumInts :: Int -> Int -> Int
hoSumInts a b = higherOrderSum (\x -> x) a b

-- Create a new higher order method which generalises over the function provided by sumInts (That is, parameterize (+) :: Int -> Int -> Int) between a and b
-- This will give the ability to perform utilities such as the product of all squares (or any other Int -> Int function) between a and b
-- You will also need to generalise the base case
-- You can also define the function signature yourself, which leaves you free to define the parameters and their order
-- To be clear, your function will need to handle:
--  - A start value, a :: Int
--  - A end value, b :: Int
--  - A function to apply to each value, op :: Int -> Int
--  - A function to apply between each value, f :: Int -> Int -> Int
--  - A value to return in the base case when a > b, z :: Int
higherOrderSequenceApplication :: (Int -> Int) -> (Int -> Int -> Int) -> Int -> Int -> Int
higherOrderSequenceApplication map reduce start end
  | end < start = error "start cannot be less than end"
  | start == end = map start
  | otherwise = reduce (map start) (higherOrderSequenceApplication map reduce (start + 1) end)

-- Define a factorial method using the higherOrderSequenceApplication
hoFactorial :: Int -> Int -> Int
hoFactorial start end = higherOrderSequenceApplication factorial (\a b -> a + b) start end

factorial :: Int -> Int
factorial a
  | a < 0 = error "input cannot be less than zero"
  | a == 0 = 1
  | otherwise = a * (factorial (a - 1))

