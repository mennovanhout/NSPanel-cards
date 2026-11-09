"""Run the navigation regression bench in installed Chromium, without npm or HA.

python dev/check-navigation-tests.py [--browser /path/to/chromium]
"""

import argparse
import functools
import html.parser
import http.server
import json
import pathlib
import shutil
import subprocess
import threading

from serve import NoCache


class ResultParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.status = None
        self.in_result = False
        self.result = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'html':
            self.status = attrs.get('data-test-status')
        if tag == 'pre' and attrs.get('id') == 'result':
            self.in_result = True

    def handle_endtag(self, tag):
        if tag == 'pre':
            self.in_result = False

    def handle_data(self, data):
        if self.in_result:
            self.result += data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser')
    args = parser.parse_args()
    browser = args.browser or next((p for name in ['chromium', 'chromium-browser', 'google-chrome']
                                   if (p := shutil.which(name))), None)
    if not browser:
        parser.error('Install Chromium or pass --browser /path/to/chromium')
    root = pathlib.Path(__file__).resolve().parent.parent
    handler = functools.partial(NoCache, directory=str(root))
    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            result = subprocess.run([
                browser, '--headless', '--no-sandbox', '--disable-dev-shm-usage',
                '--no-first-run', '--disable-gpu', '--no-default-browser-check',
                '--password-store=basic', '--use-mock-keychain',
                '--disable-background-networking',
                '--virtual-time-budget=20000', '--dump-dom',
                f'http://127.0.0.1:{server.server_port}/dev/navigation-tests.html',
            ], capture_output=True, text=True, timeout=45, check=True)
            parsed = ResultParser()
            parsed.feed(result.stdout)
            if parsed.status != 'passed':
                raise SystemExit('Navigation tests failed or did not finish:\n' + parsed.result)
            cases = json.loads(parsed.result)
            if not cases or not all(c['passed'] for c in cases):
                raise SystemExit('Missing or failing switch test results')
            print(f'{len(cases)} navigation regression cases passed')
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()
