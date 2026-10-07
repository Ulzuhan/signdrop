"""Neither a tag nor an environment variable opens the preparation gate."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_policy', Path(__file__).parents[1] / 'release-policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ReleasePolicyTests(unittest.TestCase):
    def test_even_owner_tag_publication_stays_disabled(self):
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'Ulzuhan/signdrop',
            'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/tags/v0.1.4',
            'PUBLICATION_AUTHORIZED': 'true', 'DEPLOYMENT_ENABLED': 'true'}):
            with self.assertRaisesRegex(ValueError, 'publication disabled'):
                policy.publication()

    def test_policy_flag_edits_require_new_reviewed_implementation(self):
        original = policy.release_policy()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'release').mkdir()
            for name, value in [('publication_authorized', True), ('revocations_ready', True),
                                ('automatic_return', True), ('baseline', {'digest': 'synthetic'}),
                                ('floating_tags', True), ('schema', True), ('schema', 1.0)]:
                (root / 'release/policy.json').write_text(json.dumps(dict(original, **{name: value})))
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    policy.release_policy(root)

    def test_fixture_labels_cannot_claim_a_return_pair(self):
        labels = policy.release_labels()
        self.assertEqual(labels['io.kaicorp.signdrop.automatic-return'], 'false')
        self.assertNotIn('io.kaicorp.signdrop.rollback-image', labels)
