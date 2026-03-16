import unittest


class TestSystemAdvancedConfigModule(unittest.TestCase):
    def test_advanced_config_module_exists(self):
        with open('frontend/system/advanced_config.ts', 'r', encoding='utf-8') as handle:
            contents = handle.read()
        self.assertIn('renderAdvancedConfig', contents)
        self.assertIn('loadConfigDocs', contents)


if __name__ == '__main__':
    unittest.main()
