module JsonLib (JsonValue(..), getString, getNumber, getBoolean, isNull, getObject, getArray, jsonValueToString) where

import Data.Maybe
import Data.List (intercalate)

data JsonValue =
  JsonString String |
  JsonNumber Double |
  JsonBoolean Bool |
  JsonNull |
  JsonObject [(String, JsonValue)] |
  JsonArray [JsonValue]
  deriving (Eq, Ord, Show)

getString :: JsonValue -> Maybe String
getString (JsonString s) = Just s
getString _ = Nothing

getNumber :: JsonValue -> Maybe Double
getNumber (JsonNumber n) = Just n
getNumber _ = Nothing

getBoolean :: JsonValue -> Maybe Bool
getBoolean (JsonBoolean b) = Just b
getBoolean _ = Nothing

isNull :: JsonValue -> Bool
isNull JsonNull = True
isNull _ = False

getObject :: JsonValue -> Maybe [(String, JsonValue)]
getObject (JsonObject o) = Just o
getObject _ = Nothing

getArray :: JsonValue -> Maybe [JsonValue]
getArray (JsonArray a) = Just a
getArray _ = Nothing

jsonValueToString :: JsonValue -> String
jsonValueToString (JsonString s) = s
jsonValueToString (JsonNumber n) = show n
jsonValueToString (JsonBoolean b) = show b
jsonValueToString JsonNull = "null"
jsonValueToString (JsonObject o) = "{" ++ keys o ++ "}"
  where keys [] = ""
        keys k = intercalate ", " (map renderKey k)
        renderKey (key, value) = show key ++ ": " ++ jsonValueToString value
jsonValueToString (JsonArray a) = "[" ++ entries a ++ "]"
  where entries [] = ""
        entries e = intercalate ", " (map jsonValueToString e)
