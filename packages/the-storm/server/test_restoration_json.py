"""Operational JSON values must validate before they can select a target or mutate a journal."""

import unittest

from restoration_json import JsonObject


class RestorationJsonTest(unittest.TestCase):
    def test_parse_requires_an_object_and_string_keys(self):
        for encoded in ("null", "[]", "123", '"object"'):
            with self.subTest(encoded=encoded), self.assertRaises(ValueError):
                JsonObject.parse(encoded)
        with self.assertRaises(ValueError):
            JsonObject.require({1: "invalid"})
        self.assertEqual(JsonObject.parse('{"request":"fixture"}').string("request"), "fixture")

    def test_strings_and_integers_reject_wrong_types_including_booleans(self):
        for value in (None, 123, True, [], {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                JsonObject({"name": value}).string("name")
        for value in (True, False, "1", 1.5, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                JsonObject({"replicas": value}).integer("replicas")
        self.assertEqual(JsonObject({"replicas": 0}).integer("replicas"), 0)
        self.assertEqual(JsonObject().string("namespace", ""), "")
        with self.assertRaises(ValueError):
            JsonObject().string("required")

    def test_nested_journal_changes_retain_identity_and_are_serialized(self):
        journal = JsonObject.parse('{"restore":{"phase":"Completed"},"items":[{"uid":"one"}]}')
        journal.object("restore")["byteVerification"] = "VERIFIED"
        self.assertEqual(journal.object("restore").string("byteVerification"), "VERIFIED")
        self.assertIs(journal.object("restore"), journal["restore"])
        journal.objects("items")[0]["uid"] = "two"
        self.assertEqual(journal.objects("items")[0].string("uid"), "two")
        readers = journal.strings("readers", {})
        readers["minecraft-tsmc"] = "reader-uid"
        self.assertIs(readers, journal["readers"])
        self.assertEqual(journal.strings("readers"), {"minecraft-tsmc": "reader-uid"})

    def test_collections_reject_malformed_elements(self):
        for value in (None, "items", ["invalid"], [1], [None]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                JsonObject({"items": value}).objects("items")
        for value in (None, [], {1: "invalid"}, {"name": 123}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                JsonObject({"labels": value}).strings("labels")
        for value in (None, "resources", [123], [None]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                JsonObject({"resources": value}).string_list("resources")
        self.assertEqual(JsonObject({"resources": ["statefulsets"]}).string_list("resources"), ["statefulsets"])


if __name__ == "__main__":
    unittest.main()
