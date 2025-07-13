module Modules (areaConv, sqInToSqCm, sqChainsToSqM) where

import DistanceConversions

-- Fill in the DistanceConversions module first, and import it here
-- create a higher-order function for converting an area between two dimensions
-- this will take the function for converting a distance, and an area to convert
-- using the functions defined in the DistanceConversions module
-- Example areaConv inchesToCentimetres 9 = 58.0644
areaConv :: (Float -> Float) -> Float -> Float
areaConv linearConversion area = linearConversion (sqrt area)^2

-- define a function for converting square inches into square centimetres
sqInToSqCm :: Float -> Float
sqInToSqCm a = areaConv inchesToCentimetres a

-- define a function for converting square chains (22 yards) to square metres
sqChainsToSqM :: Float -> Float
sqChainsToSqM a = areaConv (\x -> x * 22 * 0.9144) a
