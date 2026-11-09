"""Local MailMate parser acceptance tests using synthetic messages only."""
import runpy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime
from pathlib import Path

find_code = runpy.run_path(str(Path(__file__).with_name("mailmate-code.py")))["find_code"]


class MailMateCodeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.now = datetime.now(timezone.utc) - timedelta(seconds=5)
        self.after = self.now - timedelta(minutes=1)

    def tearDown(self):
        self.directory.cleanup()

    def message(self, filename, code, *, recipient="owner@example.test", date=None):
        message = EmailMessage()
        message["From"] = "no-reply@builtbybit.com"
        message["To"] = recipient
        message["Subject"] = "Email confirmation code"
        message["Date"] = format_datetime(date or self.now)
        message.set_content("Your confirmation code: " + code)
        (self.root / filename).write_bytes(message.as_bytes())

    def test_fresh_code_for_exact_recipient(self):
        self.message("valid.eml", "123456")
        self.assertEqual(find_code(self.root, "owner@example.test", self.after), "123456")

    def test_stale_and_other_recipient_are_excluded(self):
        self.message("old.eml", "123456", date=self.after - timedelta(seconds=1))
        self.message("other.eml", "234567", recipient="other@example.test")
        self.assertIsNone(find_code(self.root, "owner@example.test", self.after))

    def test_latest_matching_email_wins(self):
        self.message("older.eml", "123456", date=self.now - timedelta(seconds=1))
        self.message("newer.eml", "234567")
        self.assertEqual(find_code(self.root, "owner@example.test", self.after), "234567")

    def test_ambiguous_code_fails(self):
        self.message("ambiguous.eml", "123456 or 234567")
        with self.assertRaisesRegex(ValueError, "unambiguous"):
            find_code(self.root, "owner@example.test", self.after)


if __name__ == "__main__":
    unittest.main()
