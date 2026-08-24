import hashlib
import unittest

from app_auth import MAX_RETRY_DELAY_SECONDS, _password_matches, _retry_delay_seconds


class AppAuthTests(unittest.TestCase):
    def test_plain_password_comparison(self):
        self.assertTrue(_password_matches("long-secret", "long-secret", ""))
        self.assertFalse(_password_matches("wrong", "long-secret", ""))

    def test_sha256_password_comparison(self):
        expected_hash = hashlib.sha256("long-secret".encode("utf-8")).hexdigest()
        self.assertTrue(_password_matches("long-secret", "", expected_hash))
        self.assertFalse(_password_matches("wrong", "", expected_hash))

    def test_retry_delay_is_exponential_and_capped(self):
        self.assertEqual(_retry_delay_seconds(0), 0)
        self.assertEqual(_retry_delay_seconds(1), 1)
        self.assertEqual(_retry_delay_seconds(2), 2)
        self.assertEqual(_retry_delay_seconds(5), 16)
        self.assertEqual(_retry_delay_seconds(20), MAX_RETRY_DELAY_SECONDS)


if __name__ == "__main__":
    unittest.main()
