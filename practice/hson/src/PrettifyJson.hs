module PrettifyJson(renderJsonValue) where

import Prettify
import JsonLib

renderJsonValue :: JsonValue -> Doc
renderJsonValue (JsonBoolean True) = text "true"
renderJsonValue (JsonBoolean False) = text "false"
renderJsonValue JsonNull = text "null"
renderJsonValue (JsonNumber number) = double number
renderJsonValue (JsonString s) = string s

text :: String -> Doc
text = undefined

string :: String -> Doc
string = undefined

double :: Double -> Doc
double = undefined
