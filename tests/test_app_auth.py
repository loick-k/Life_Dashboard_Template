import hashlib
import unittest

from app_auth import _password_matches


class AppAuthTests(unittest.TestCase):
    def test_plain_password_comparison(self):
        self.assertTrue(_password_matches("long-secret", "long-secret", ""))
        self.assertFalse(_password_matches("wrong", "long-secret", ""))

    def test_sha256_password_comparison(self):
        expected_hash = hashlib.sha256("long-secret".encode("utf-8")).hexdigest()
        self.assertTrue(_password_matches("long-secret", "", expected_hash))
        self.assertFalse(_password_matches("wrong", "", expected_hash))


if __name__ == "__main__":
    unittest.main()
