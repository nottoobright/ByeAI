"""Verifies rate limiting on /flags and /vote.

NOTE: We use /flags for the IP-burst test because /vote requires a valid
JSON body for every request, which complicates a tight loop.
"""
import pytest

from starlette.datastructures import Headers


VALID_HASH = "11111111-1111-4111-8111-111111111111"
VALID_VIDEO = "abcdefghijk"


def _flag_url(video_id=VALID_VIDEO):
    return f"/flags?ids={video_id}"


class _FakeRequest:
    """Minimal stand-in exposing the two attributes _rate_limit_key reads."""

    class _Client:
        def __init__(self, host):
            self.host = host

    def __init__(self, peer_host="172.18.0.4", headers=None):
        self.client = self._Client(peer_host)
        self.headers = Headers(headers or {})


def test_flags_endpoint_rate_limit_returns_429(client):
    """Sending more than the per-IP limit returns 429."""
    last_status = None
    for _ in range(125):
        last_status = client.get(_flag_url()).status_code
        if last_status == 429:
            break
    assert last_status == 429


def test_health_endpoint_is_not_rate_limited(client):
    """Health checks must remain unrestricted for monitoring."""
    statuses = [client.get("/health").status_code for _ in range(150)]
    assert all(s == 200 for s in statuses)


def test_429_response_has_rate_limit_headers(client):
    """Clients should know when to retry. slowapi sets X-RateLimit-* headers
    when headers_enabled=True. Retry-After is also acceptable."""
    last = None
    for _ in range(125):
        last = client.get(_flag_url())
        if last.status_code == 429:
            break
    assert last.status_code == 429
    header_keys = {k.lower() for k in last.headers.keys()}
    # Accept any of the standard rate-limit indicators
    assert header_keys & {"retry-after", "x-ratelimit-limit", "x-ratelimit-reset", "x-ratelimit-remaining"}, \
        f"Expected rate-limit header in {sorted(header_keys)}"


class TestRateLimitKey:
    """All traffic reaches the app through Caddy, so request.client.host is
    always the proxy's container IP. Keying on it puts every ByeAI user in the
    world into one shared bucket, which is what caused live /flags 429s.
    """

    def test_falls_back_to_peer_ip_when_no_forwarded_header(self):
        """No X-Forwarded-For must behave exactly as before the fix."""
        from main import _rate_limit_key
        assert _rate_limit_key(_FakeRequest(peer_host="172.18.0.4")) == "172.18.0.4"

    def test_uses_forwarded_client_ip(self):
        from main import _rate_limit_key
        req = _FakeRequest(headers={"X-Forwarded-For": "203.0.113.7"})
        assert _rate_limit_key(req) == "203.0.113.7"

    def test_uses_rightmost_entry_so_client_cannot_spoof(self):
        """Caddy APPENDS the peer IP, so anything the client injects is pushed
        left. The rightmost entry is the address Caddy actually observed."""
        from main import _rate_limit_key
        req = _FakeRequest(headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.7"})
        assert _rate_limit_key(req) == "203.0.113.7"

    def test_tolerates_whitespace_and_header_case(self):
        from main import _rate_limit_key
        req = _FakeRequest(headers={"x-forwarded-for": "  1.2.3.4 ,  203.0.113.7  "})
        assert _rate_limit_key(req) == "203.0.113.7"

    def test_blank_forwarded_header_falls_back_to_peer_ip(self):
        from main import _rate_limit_key
        req = _FakeRequest(peer_host="172.18.0.4", headers={"X-Forwarded-For": "   "})
        assert _rate_limit_key(req) == "172.18.0.4"


def test_distinct_forwarded_ips_get_independent_buckets(client):
    """Exhausting one user's /flags budget must not deny a different user.

    This is the actual production regression: before the fix both users keyed
    to the Caddy container IP and shared a single 120/min bucket.
    """
    exhausted = None
    for _ in range(130):
        exhausted = client.get(_flag_url(), headers={"X-Forwarded-For": "198.51.100.1"}).status_code
        if exhausted == 429:
            break
    assert exhausted == 429, "expected the first client to hit its own limit"

    other = client.get(_flag_url(), headers={"X-Forwarded-For": "198.51.100.2"})
    assert other.status_code == 200, "a different client IP must have its own bucket"
