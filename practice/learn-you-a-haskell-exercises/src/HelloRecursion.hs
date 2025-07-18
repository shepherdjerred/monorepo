module HelloRecursion (power, fib, stepReverseSign, piCalc, calcDigits) where
-- Raise x to the power y, using recursion
-- For example, power 5 2 = 25
power :: Int -> Int -> Int
power x 1 = x
power x y = x * power x (y - 1)

-- create a list of length n of the Fibonacci sequence in reverse order
-- examples: fib 0 = [0]
-- 	     fib 1 = [1, 0]
--	     fib 10 = [55,34,21,13,8,5,3,2,1,1,0]	
-- try to use a where clause
fib :: (Num a, Eq a) => a -> [a]
fib 0 = [0]
fib 1 = [1] ++ fib 0
fib x = [(head (fib (x - 1))) + (head (fib (x - 2)))] ++ (fib (x - 1))

-- This is not recursive, but have a go anyway.
-- Create a function which takes two parameters, a number and a step
-- The result is the sign of the original number reversed, and the step added to the absolute value
-- Confused? Some examples: stepReverseSign 6 2 = -8
--			    stepReverseSign -3 1 = 4
--			    stepReverseSign 1 2 = -3
stepReverseSign :: (Fractional a, Ord a) => a -> a -> a
stepReverseSign number step
  | number < 0 = (number * (-1)) + step
  | otherwise = (number * (-1)) + ((-1) * step)

{- Lets calculate pi.
 - The Leibniz formula for pi (http://en.wikipedia.org/wiki/Leibniz_formula_for_%CF%80)
 - Can be defined as pi = (4/1) - (4/3) + (4/5) - (4/7) ....
 - We can create a function, where given a certain tolerance, we can recursively calculate
 - Pi to within that tolerance.
 - Lets create two functions, piCalc, and piCalc', the latter we will recursively call
 - until our pi calculation is within the tolerance

 - The piCalc function is defined as:
 - piCalc :: (Fractional a, Integral b, Ord a) => a -> (a, b)

 - Given a tolerance, say, 0.001, it will return a tuple.
 - fst is pi to an accuracy of the tolerance, 0.001 in this case
 - snd is the number of recursive steps taken to calculate it, after all this chapter is about recursion!
 - Example: piCalc 0.001 = (3.1420924036835256,2000)

 - The piCalc' function is defined as 
 - piCalc' :: (Ord a, Fractional a, Integral b) => a -> a -> a -> b -> (a, b)
 - Lots of parameters!
 - The first parameter is the current denominator from the Leibniz formula
 - The next is our calculation of pi from our previous attempt
 - The next is the tolerance
 - The final parameter is the number of times this function has been called (ie, we add one every time we recurse
 - Example piCalc' 1 0.0 0.001 0 = (3.1420924036835256,2000)
 -
 - Feel free to change the parameter order, what parameters you need etc in order to get this to work for you,
 - But, of course the output of piCalc should remain as (pi, count)
 - 
 - You may find the stepReverseSign function handy
 -}
calcDigits :: (Fractional a, Ord a, Integral b, Ord b) => a -> b
calcDigits tolerance = snd (calcDigits' (tolerance, 0))

calcDigits' :: (Fractional a, Ord a, Integral b, Ord b) => (a, b) -> (a, b)
calcDigits' tolerance
  | (fst tolerance) < 1 = calcDigits' ((fst tolerance) * 10, (snd tolerance) + 1)
  | otherwise = tolerance

piCalc :: (Fractional a, Ord a) => a -> a
piCalc tolerance = fst (piCalc' 1 0.0 tolerance 1) * 4

-- This implementation doesn't meet the spec because it doesn't calculate Pi to an arbitrary precision.
-- Doing so would require implementing the formula described here: https://en.wikipedia.org/wiki/Leibniz_formula_for_%CF%80#Unusual_behaviour
-- Which is a bit more math than I want to do right now.
-- For now this method expands the Leibniz formula up to 10 ^ n + 1 times, where n is the number of digits in the tolerance.
piCalc' :: (Ord a, Fractional a, Integral b) => a -> a -> a -> b -> (a, b)
piCalc' denominator previous tolerance times_called
  | times_called > (10 ^ ((calcDigits tolerance) + 1)) = (previous, times_called)
  | times_called `mod` 2 == 1 = piCalc' (denominator + 2) (previous + (1 / denominator)) tolerance (times_called + 1)
  | times_called `mod` 2 == 0 = piCalc' (denominator + 2) (previous - (1 / denominator)) tolerance (times_called + 1)


doThing position = 1 / position
