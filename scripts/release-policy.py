#!/usr/bin/env python3
"""Preparation gate: CI may inspect unsigned OCI bytes; publication is disabled."""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def release_policy(root=ROOT):
    data = json.loads((root / 'release/policy.json').read_text())
    expected = {'schema': 1, 'lane': 'preparation-only-v1',
                'publication_authorized': False, 'automatic_return': False,
                'revocations_ready': False, 'baseline': None, 'floating_tags': False}
    if data != expected or type(data['schema']) is not int or any(
            type(data[name]) is not bool for name in (
                'publication_authorized', 'automatic_return', 'revocations_ready', 'floating_tags')):
        raise ValueError('activation requires a separately reviewed policy and safe signed baseline')
    return data


def release_version(root=ROOT):
    version = json.loads((root / 'package.json').read_text())['version']
    lock = json.loads((root / 'package-lock.json').read_text())
    if (not re.fullmatch(r'0\.1\.[1-9][0-9]*', version)
            or lock['version'] != version or lock['packages']['']['version'] != version):
        raise ValueError('package/lock version differs')
    return version


def release_labels(root=ROOT):
    release_policy(root)
    return {'org.opencontainers.image.version': release_version(root),
            'io.kaicorp.signdrop.deployment-lane': 'preparation-only-v1',
            'io.kaicorp.signdrop.automatic-return': 'false'}


def publication(root=ROOT):
    release_policy(root)
    raise ValueError('publication disabled: safe baseline and durable revocations pending separate review')


if __name__ == '__main__':
    try:
        release_policy()
        release_version()
        if sys.argv[1:] == ['--publication']:
            publication()
        elif sys.argv[1:] == ['--labels']:
            print('\n'.join(name + '=' + value for name, value in release_labels().items()))
        elif sys.argv[1:]:
            raise ValueError('unsupported arguments')
        else:
            print('preparation-only-v1; publication disabled; no approved rollback image')
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
