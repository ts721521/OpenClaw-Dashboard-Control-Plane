import unittest

from fastapi.testclient import TestClient

from app.main import app


class FastAPIHealthTests(unittest.TestCase):
    def test_health_ok(self):
        client = TestClient(app)
        res = client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "ok")


if __name__ == "__main__":
    unittest.main()
