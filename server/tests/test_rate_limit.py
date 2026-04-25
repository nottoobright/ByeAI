"""Verifies rate limiting on /flags and /vote.

NOTE: We use /flags for the IP-burst test because /vote requires a valid
JSON body for every request, which complicates a tight loop.
"""
import pytest


VALID_HASH = "11111111-1111-4111-8111-111111111111"
VALID_VIDEO = "abcdefghijk"


def _flag_url(video_id=VALID_VIDEO):
    return f"/flags?ids={video_id}"


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
