import unittest


class TestSystemArchitectureModule(unittest.TestCase):
    def test_architecture_module_exists(self):
        with open('frontend/system/architecture.ts', 'r', encoding='utf-8') as handle:
            contents = handle.read()
        self.assertIn('renderArchitecture', contents)
        self.assertIn('selectArchitectureObject', contents)


if __name__ == '__main__':
    unittest.main()
