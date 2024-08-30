module TypesAndTypeclasses(Color(..), firstColor, reverseColorOrder, paintMix) where
import Data.List
{-
 - For this exercise, we are dealing with a type for colors of the rainbow
 - The typeclass is defined here, and note its English spelling.
 - For more information on how this is done, look ahead to:
 - http://learnyouahaskell.com/making-our-own-types-and-typeclasses
 -
 - Have a play with the Color in ghci, try the succ and pred functions and so on.
 -}
data Color = Red | Orange | Yellow | Green | Blue | Indigo | Violet
    deriving (Eq, Ord, Show, Bounded, Enum)

{-
 - Again, you should be able to write these functions in one line, 
 - using the information from the chapter http://learnyouahaskell.com/types-and-typeclasses
 - and the chapter before
 -}

{-
 - The Color typeclass is of type Ord
 - What is the "first" (or least) color
 -}
firstColor = (minBound :: Color)
lastColor = (maxBound :: Color)

colors = [firstColor..]

-- List the colors in reverse order
reverseColorOrder = reverse colors

{-
 - Mix two colors together, to produce the average value of the two.
 - Example: paintMix Orange Green = Yellow
 - If necessary, favour the "higher" value when computing the average.
 - For example: paintMix Green Violet = Indigo
 - Hint: Integer division can be performed with the quot function: quot 7 2 = 3
 -}
paintMix c1 c2 = undefined
