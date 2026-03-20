import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestFastAPILayouts(unittest.TestCase):
    def test_architecture_layout_roundtrip(self):
        client = TestClient(app)
        payload = {
            "positions": {
                "team:team-rd": {"x": 120, "y": 80},
            }
        }
        put_response = client.put("/api/architecture/layout", json=payload)
        self.assertEqual(put_response.status_code, 200)
        get_response = client.get("/api/architecture/layout")
        self.assertEqual(get_response.status_code, 200)
        body = get_response.json()
        self.assertEqual(body["positions"]["team:team-rd"]["x"], 120)
        self.assertEqual(body["positions"]["team:team-rd"]["y"], 80)

    def test_inter_team_layout_roundtrip(self):
        client = TestClient(app)
        payload = {
            "positions": {
                "team:team-km": {"x": 300, "y": 160},
            }
        }
        put_response = client.put("/api/inter-team-flow/layout", json=payload)
        self.assertEqual(put_response.status_code, 200)
        get_response = client.get("/api/inter-team-flow/layout")
        self.assertEqual(get_response.status_code, 200)
        body = get_response.json()
        self.assertEqual(body["positions"]["team:team-km"]["x"], 300)
        self.assertEqual(body["positions"]["team:team-km"]["y"], 160)

