"""Password strength rules.

Kept in one module so the API, the tests and any future admin tooling all
enforce identical rules -- a policy duplicated across call sites is a policy
that drifts.

The rules deliberately follow NIST SP 800-63B rather than the older
"one uppercase, one symbol" tradition:

  * length is the dominant factor, so the minimum is 10 rather than 8;
  * a character-class matrix is NOT required, because it pushes people towards
    "Passw0rd!" -- which satisfies every class rule and is trivially cracked;
  * instead, obvious weak passwords are rejected outright by blocklist, and
    passwords containing the user's own name or email are rejected because
    those are the first things an attacker tries.

Composition is limited to "must contain a letter and a digit", which is what
the improvement plan asked for and which blocks the pure-dictionary case
without encouraging predictable substitutions.
"""
from __future__ import annotations

import re
import unicodedata

MIN_LENGTH = 10
# Bcrypt silently truncates at 72 BYTES. Without an explicit cap, two
# different long passwords can hash identically -- a real (if exotic) auth
# bypass. Rejecting early is clearer than silently ignoring the tail.
MAX_LENGTH = 72

# The passwords that actually appear in credential-stuffing lists, plus the
# ones this project's own docs and seeds use. Compared case-insensitively
# after normalisation.
COMMON_PASSWORDS = {
    "password", "password1", "password12", "password123", "password1234",
    "passw0rd", "p@ssword", "p@ssw0rd", "letmein", "welcome", "welcome1",
    "qwerty", "qwerty123", "qwertyuiop", "123456", "1234567", "12345678",
    "123456789", "1234567890", "111111", "000000", "abc123", "abcd1234",
    "iloveyou", "admin", "admin123", "administrator", "root", "toor",
    "changeme", "secret", "monkey", "dragon", "sunshine", "princess",
    "football", "baseball", "master", "shadow", "superman", "trustno1",
    "buildiq", "buildiq123", "construction", "construction123",
    "demo1234", "demo1234!", "test1234", "temp1234",
}

_ASCII_SEQUENCES = ("abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl")


class PasswordPolicyError(ValueError):
    """Raised with a message safe to show the user."""


def _normalise(pw: str) -> str:
    # NFKC so visually identical passwords compare equal regardless of how
    # the keyboard encoded them.
    return unicodedata.normalize("NFKC", pw)


def _strip_non_alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _has_long_run(pw: str, n: int = 4) -> bool:
    """Four or more identical characters in a row, e.g. 'aaaa'."""
    run = 1
    for a, b in zip(pw, pw[1:]):
        run = run + 1 if a == b else 1
        if run >= n:
            return True
    return False


def _has_sequence(pw: str, n: int = 5) -> bool:
    """Five or more consecutive keyboard/alphabet characters, e.g. '12345'."""
    low = pw.lower()
    for seq in _ASCII_SEQUENCES:
        for i in range(len(seq) - n + 1):
            chunk = seq[i:i + n]
            if chunk in low or chunk[::-1] in low:
                return True
    return False


def validate_password(password: str, *, email: str | None = None,
                      full_name: str | None = None) -> None:
    """Raise PasswordPolicyError if the password is unacceptable.

    `email` and `full_name` are optional but should be passed whenever they
    are known: "AbebeKebede1" is a fine-looking password right up until you
    learn the user is Abebe Kebede.
    """
    if password is None:
        raise PasswordPolicyError("A password is required.")

    pw = _normalise(password)

    if len(pw) < MIN_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at least {MIN_LENGTH} characters "
            f"(yours is {len(pw)})."
        )
    if len(pw.encode("utf-8")) > MAX_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at most {MAX_LENGTH} bytes long."
        )
    if pw != pw.strip():
        raise PasswordPolicyError(
            "Password cannot begin or end with a space."
        )
    if not re.search(r"[A-Za-z]", pw):
        raise PasswordPolicyError("Password must contain at least one letter.")
    if not re.search(r"\d", pw):
        raise PasswordPolicyError("Password must contain at least one number.")

    flat = _strip_non_alnum(pw)
    if flat in COMMON_PASSWORDS or pw.lower() in COMMON_PASSWORDS:
        raise PasswordPolicyError(
            "That password is too common. Choose something less predictable."
        )
    if _has_long_run(pw):
        raise PasswordPolicyError(
            "Password cannot contain the same character four times in a row."
        )
    if _has_sequence(pw):
        raise PasswordPolicyError(
            "Password cannot contain a long run like '12345' or 'abcde'."
        )

    if email:
        local = _strip_non_alnum(email.split("@")[0])
        if len(local) >= 4 and local in flat:
            raise PasswordPolicyError(
                "Password cannot contain your email address."
            )
    if full_name:
        for part in re.split(r"\s+", full_name.strip()):
            token = _strip_non_alnum(part)
            if len(token) >= 4 and token in flat:
                raise PasswordPolicyError(
                    "Password cannot contain your name."
                )


def strength(password: str) -> dict:
    """A rough 0-4 score for the UI meter. Not a security control."""
    pw = _normalise(password or "")
    score = 0
    if len(pw) >= MIN_LENGTH:
        score += 1
    if len(pw) >= 14:
        score += 1
    classes = sum(bool(re.search(p, pw)) for p in
                  (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    if classes >= 3:
        score += 1
    if classes >= 4 or len(pw) >= 20:
        score += 1
    try:
        validate_password(pw)
    except PasswordPolicyError:
        score = min(score, 1)
    labels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"]
    return {"score": score, "label": labels[score]}
