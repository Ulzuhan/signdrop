#!/usr/bin/env python3
"""Unsigned same-artifact fixture. No real version pair, admission or publication."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

SECRET = 'e2e-signdrop-secret-with-at-least-32-bytes'
NAME = 'signdrop-ci-fixture'
BASE = 'http://127.0.0.1:4021'


def command(*args, env=None, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=600, env=env)
    if check and result.returncode:
        raise RuntimeError(args[0] + ' failed (isolated fixture)')
    return result.stdout.strip()


def remove():
    command('docker', 'rm', '-f', NAME, check=False)


def start(image, identity=True, secret=SECRET):
    remove()
    args = ['docker', 'run', '-d', '--name', NAME, '--init', '--read-only',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m,mode=0700,uid=10001,gid=10001',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--stop-timeout=20',
            '-p', '127.0.0.1:4021:3466', '-e', 'SIGNDROP_SESSION_SECRET=' + secret,
            '-e', 'SIGNDROP_PUBLIC_HOST=127.0.0.1:4021']
    if identity:
        # HTTPS names reserved for fixtures. No provider or credential is used.
        for key, value in {'ISSUER': 'https://issuer.example.invalid/auth/v1',
                           'CLIENT_ID': 'fixture', 'CLIENT_SECRET': 'fixture',
                           'REDIRECT_URI': 'https://example.invalid/api/auth/callback'}.items():
            args += ['-e', 'SIGNDROP_OIDC_' + key + '=' + value]
    command(*args, image)
    actual = command('docker', 'inspect', NAME, '--format', '{{.Image}}')
    if actual != image:
        raise RuntimeError('runtime differs from verified OCI config ID')


def health(expected=200):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            try:
                response = urllib.request.urlopen(BASE + '/api/health', timeout=3)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status, data = response.code, json.load(response)
            if status == expected:
                assert data['session'] is True
                assert data['identity'] is (expected == 200)
                assert data['status'] == ('ok' if expected == 200 else 'degraded')
                assert type(data['trustedLists']) is int and data['trustedLists'] > 0, data
                return data
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    raise RuntimeError('fixture readiness timed out')


def assets():
    for path in ['/trust/index.json', '/pdfjs/pdf.worker.min.mjs',
                 '/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
                 '/pdfjs/standard_fonts/FoxitSerif.pfb', '/verify']:
        with urllib.request.urlopen(BASE + path, timeout=10) as response:
            assert response.code == 200 and response.read(16), path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', args.image):
        raise ValueError('exact verified config ID required')
    try:
        start(args.image)
        ready = health()
        assets()
        # Existing desktop/phone/WebKit signing and verification suites execute
        # this exact container. Playwright must never start its host build here.
        env = dict(os.environ, E2E_EXTERNAL_SERVER='1', E2E_PORT='4021', CI='true')
        subprocess.run(['npm', 'run', 'test:e2e'], env=env, check=True, timeout=900)
        command('docker', 'stop', '--time', '20', NAME)
        start(args.image, identity=False)
        health(503)
        command('docker', 'stop', '--time', '20', NAME)
        start(args.image)
        health()
        assets()
        start(args.image, secret='too-short')
        time.sleep(2)
        assert command('docker', 'inspect', NAME, '--format', '{{.State.Status}}') == 'exited'
        args.report.write_text(json.dumps({'schema': 1, 'config_id': args.image,
            'fixture': 'unsigned-same-artifact-configuration-return',
            'real_version_pair': False, 'production_admission': False,
            'scenarios': ['exact-oci-browser-sign-verify', 'degraded-identity',
                          'return-to-ready-configuration', 'missing-secret-refuses-start'],
            'trusted_lists': ready['trustedLists']}, indent=2) + '\n')
    finally:
        remove()


if __name__ == '__main__':
    main()
