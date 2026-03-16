import unittest


class TestSystemGovernanceModule(unittest.TestCase):
    def test_governance_module_exists(self):
        with open('frontend/system/governance.ts', 'r', encoding='utf-8') as handle:
            contents = handle.read()
        self.assertIn('renderGovernance', contents)
        self.assertIn('loadGovernance', contents)


if __name__ == '__main__':
    unittest.main()
