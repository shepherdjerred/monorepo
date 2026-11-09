"""Read a fresh BuiltByBit confirmation code; stdout is a private parent pipe."""
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path


def find_code(root: Path, recipient: str, after: datetime) -> str | None:
    if not root.is_dir():
        raise ValueError("MailMate message directory is unavailable")
    result = subprocess.run(
        ["rg", "-l", "-i", "--glob", "*.eml", r"builtbybit\.com|mc-market\.org", str(root)],
        capture_output=True, text=True, check=False,
    )
    if result.returncode not in (0, 1):
        raise ValueError("MailMate message search failed")
    candidates: list[tuple[datetime, str]] = []
    for filename in result.stdout.splitlines():
        with Path(filename).open("rb") as stream:
            message = BytesParser(policy=policy.default).parse(stream)
        sender = getaddresses([str(message.get("From", ""))])[0][1].lower()
        if not sender.endswith(("@builtbybit.com", "@mc-market.org")):
            continue
        if not re.search(r"confirmation|verification", str(message.get("Subject", "")), re.I):
            continue
        recipient_headers = [str(message[key]) for key in ("To", "Delivered-To", "X-Original-To") if message.get(key)]
        recipients = getaddresses(recipient_headers)
        if recipient.lower() not in {address.lower() for _, address in recipients}:
            continue
        date = parsedate_to_datetime(str(message.get("Date", "")))
        if date.tzinfo is None:
            raise ValueError("Verification email is missing a timezone")
        if date < after or date > datetime.now(UTC):
            continue
        body = message.get_body(preferencelist=("plain",))
        if body is None:
            raise ValueError("Fresh verification email has no plain-text body")
        codes = set(re.findall(r"\b\d{6,8}\b", body.get_content()))
        if len(codes) != 1:
            raise ValueError("Fresh verification email has no unambiguous code")
        candidates.append((date, codes.pop()))
    return max(candidates, key=lambda entry: entry[0])[1] if candidates else None


if __name__ == "__main__":
    data = json.load(sys.stdin)
    if not isinstance(data["root"], str) or not isinstance(data["recipient"], str):
        raise ValueError("Invalid MailMate code request")
    if type(data["after"]) not in (int, float):
        raise ValueError("Invalid verification request time")
    code = find_code(Path(data["root"]), data["recipient"], datetime.fromtimestamp(data["after"] / 1000, UTC))
    print(json.dumps({"status": "pending"} if code is None else {"status": "found", "code": code}))
