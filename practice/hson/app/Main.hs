module Main (main) where

import JsonLib

main :: IO ()
main = print $ jsonValueToString ((JsonObject [("test", JsonNumber 1), ("another", JsonString "Hello!"), ("and another", JsonBoolean True), ("heres a list", JsonArray [JsonNumber 1])]))
