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
VOLUME = 'signdrop-ci-revocations-fixture'
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
            '--network=host', '--mount', 'type=volume,src=' + VOLUME + ',dst=/var/lib/signdrop',
            '-e', 'SIGNDROP_PORT=4021', '-e', 'PORT=4021', '-e', 'SIGNDROP_HOST=127.0.0.1',
            '-e', 'SIGNDROP_SESSION_SECRET=' + secret,
            '-e', 'SIGNDROP_PUBLIC_HOST=127.0.0.1:4021']
    if identity:
        # The existing RSA-signing mock provider runs only on this CI runner's loopback.
        for key, value in {'ISSUER': 'http://127.0.0.1:9995/application/o/signdrop',
                           'CLIENT_ID': 'signdrop-pruebas', 'CLIENT_SECRET': 'fixture',
                           'REDIRECT_URI': BASE + '/api/auth/callback'}.items():
            args += ['-e', 'SIGNDROP_OIDC_' + key + '=' + value]
    command(*args, image)
    actual = command('docker', 'inspect', NAME, '--format', '{{.Image}}')
    if actual != image:
        raise RuntimeError('runtime differs from verified OCI config ID')


def health(expected=200, session=True, identity=None):
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
                assert data['session'] is session
                assert data['identity'] is (expected == 200 if identity is None else identity)
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


def docker_health():
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if command('docker', 'inspect', NAME, '--format', '{{.State.Health.Status}}') == 'healthy':
            return
        time.sleep(1)
    raise RuntimeError('Docker HEALTHCHECK did not observe the ready fixture on its configured port')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', args.image):
        raise ValueError('exact verified config ID required')
    proof = args.report.parent / 'signdrop-revocation-fixture.json'
    command('docker', 'volume', 'create', VOLUME)
    try:
        start(args.image)
        time.sleep(2)
        assert command('docker', 'inspect', NAME, '--format', '{{.State.Status}}') == 'exited', 'missing store must refuse startup'
        remove()
        # Only this named CI fixture volume is initialized, by runtime uid 10001.
        command('docker', 'run', '--rm', '--read-only', '--cap-drop=ALL',
                '--security-opt=no-new-privileges', '--mount',
                'type=volume,src=' + VOLUME + ',dst=/var/lib/signdrop',
                '--entrypoint', 'node', args.image, 'init-revocations.js', '--new')
        start(args.image)
        ready = health()
        assets()
        # Existing desktop/phone/WebKit signing and verification suites execute
        # this exact container. Playwright must never start its host build here.
        env = dict(os.environ, E2E_EXTERNAL_SERVER='1', E2E_PORT='4021', CI='true')
        subprocess.run(['npm', 'run', 'test:e2e'], env=env, check=True, timeout=900)
        proof_env = dict(os.environ, BASE=BASE, SIGNDROP_SESSION_SECRET=SECRET,
                         REVOCATION_PROOF=str(proof), CLIENT_ID='signdrop-pruebas')
        subprocess.run(['node', 'scripts/test-backchannel.mjs'], env=proof_env, check=True, timeout=120)
        docker_health()
        # Fault only this private fixture file. A running degraded service
        # rejects all account cookies but preserves guests/public verification.
        command('docker', 'exec', NAME, 'node', '-e',
                "require('node:fs').chmodSync(process.env.SIGNDROP_REVOCATION_DB, 0o400)")
        health(503, session=False, identity=True)
        subprocess.run(['node', 'scripts/check-revoked-session.mjs'],
                       env=dict(proof_env, STATE_UNAVAILABLE='1'), check=True, timeout=30)
        command('docker', 'exec', NAME, 'node', '-e',
                "require('node:fs').chmodSync(process.env.SIGNDROP_REVOCATION_DB, 0o600)")
        health()
        command('docker', 'stop', '--time', '20', NAME)
        start(args.image, identity=False)
        health(503)
        subprocess.run(['node', 'scripts/check-revoked-session.mjs'], env=proof_env, check=True, timeout=30)
        command('docker', 'stop', '--time', '20', NAME)
        start(args.image)
        health()
        assets()
        subprocess.run(['node', 'scripts/check-revoked-session.mjs'], env=proof_env, check=True, timeout=30)
        start(args.image, secret='too-short')
        time.sleep(2)
        assert command('docker', 'inspect', NAME, '--format', '{{.State.Status}}') == 'exited'
        args.report.write_text(json.dumps({'schema': 1, 'config_id': args.image,
            'fixture': 'unsigned-same-artifact-configuration-return',
            'real_version_pair': False, 'production_admission': False,
            'scenarios': ['exact-oci-browser-sign-verify', 'degraded-identity',
                          'durable-revocation-after-container-recreation', 'unaffected-account',
                          'guest-signature-preserved', 'return-to-ready-configuration',
                          'revocation-preserved-on-compatible-configuration-return', 'missing-secret-refuses-start',
                          'missing-store-refuses-start', 'read-only-store-denies-accounts-preserves-guests'],
            'trusted_lists': ready['trustedLists']}, indent=2) + '\n')
    finally:
        remove()
        command('docker', 'volume', 'rm', VOLUME, check=False)
        proof.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
