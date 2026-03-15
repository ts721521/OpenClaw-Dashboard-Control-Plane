import os
import unittest
from pathlib import Path


class RuntimePathTests(unittest.TestCase):
    def test_resolve_runtime_env_uses_external_openclaw_paths(self):
        from dashboard_runtime import resolve_runtime_config

        cfg = resolve_runtime_config(
            repo_dir="/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane",
            environ={
                "OPENCLAW_BASE_DIR": "/tmp/openclaw-base",
                "OPENCLAW_WORKSPACE": "/tmp/openclaw-workspace",
                "PORT": "9999",
            },
        )

        self.assertEqual(cfg.base_dir, Path("/tmp/openclaw-base").resolve())
        self.assertEqual(cfg.workspace_dir, Path("/tmp/openclaw-workspace").resolve())
        self.assertEqual(cfg.repo_dir, Path("/Users/tianshuai/Documents/GitHub/OpenClaw-Dashboard-Control-Plane").resolve())
        self.assertEqual(cfg.port, 9999)

    def test_resolve_runtime_env_defaults_to_openclaw_home(self):
        from dashboard_runtime import DEFAULT_BASE_DIR, resolve_runtime_config

        cfg = resolve_runtime_config(repo_dir="/tmp/dashboard-repo", environ={})

        self.assertEqual(cfg.base_dir, DEFAULT_BASE_DIR)
        self.assertEqual(cfg.workspace_dir, DEFAULT_BASE_DIR / "workspace")
        self.assertEqual(cfg.repo_dir, Path("/tmp/dashboard-repo").resolve())
        self.assertEqual(cfg.port, 8080)


if __name__ == "__main__":
    unittest.main()

class ModelParsingTests(unittest.TestCase):
    def test_model_pair_accepts_string_model_config(self):
        from server import model_pair

        primary, fallbacks = model_pair("openai/gpt-5")

        self.assertEqual(primary, "openai/gpt-5")
        self.assertEqual(fallbacks, [])
