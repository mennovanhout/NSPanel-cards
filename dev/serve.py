"""Static server for the preview bench, with caching turned off.

python -m http.server is fine until Chrome caches dist/nspanel-cards.js and the
bench quietly renders the *previous* bundle - which is how a screenshot of code
that no longer exists gets committed. Same failure mode the README warns HA
users about, so the dev server refuses to let it happen.

    python dev/serve.py [port]        # from the repo root
"""

import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8177
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCache, directory=root)
    print('bench: http://localhost:%d/dev/bench.html  (ctrl-c to stop)' % port)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
