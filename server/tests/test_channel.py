"""TDD for channel-level flagging endpoints."""
import pytest


VALID_HASH_A = "11111111-1111-4111-8111-111111111111"
VALID_HASH_B = "22222222-2222-4222-8222-222222222222"
VALID_CHANNEL = "UCabcdefghijklmnopqrstuv"  # 24 chars, starts with UC
VALID_CATEGORY = "ai-script"


def _vote_payload(channel_id=VALID_CHANNEL, client_hash=VALID_HASH_A, category=VALID_CATEGORY):
    return {
        "channelId": channel_id,
        "category": category,
        "clientHash": client_hash,
        "timestamp": 1700000000000,
    }


def test_post_channel_vote_creates_channel_and_vote(client):
    resp = client.post("/channel/vote", json=_vote_payload())
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    assert body["new_score"] >= 1
    assert body["is_flagged"] is False  # one vote isn't enough


def test_post_channel_vote_rejects_invalid_channel_id(client):
    bad = _vote_payload(channel_id="not-a-channel")
    resp = client.post("/channel/vote", json=bad)
    assert resp.status_code == 422


def test_post_channel_vote_rejects_duplicate_category_from_same_user(client):
    payload = _vote_payload()
    assert client.post("/channel/vote", json=payload).status_code == 200
    assert client.post("/channel/vote", json=payload).status_code == 409


def test_get_channels_returns_only_flagged(client):
    """10 distinct users each cast their first vote → score crosses threshold of 10."""
    for i in range(10):
        h = f"{i:08x}-1111-4111-8111-111111111111"
        client.post("/channel/vote", json=_vote_payload(client_hash=h))

    resp = client.get(f"/channels?ids={VALID_CHANNEL}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["channels"]) == 1
    assert body["channels"][0]["id"] == VALID_CHANNEL


def test_get_channels_with_no_match_returns_empty(client):
    resp = client.get(f"/channels?ids={VALID_CHANNEL}")
    assert resp.status_code == 200
    assert resp.json() == {"channels": []}


def test_get_channels_validates_id_format(client):
    resp = client.get("/channels?ids=not-valid")
    assert resp.status_code == 200  # invalid IDs filtered, not rejected
    assert resp.json() == {"channels": []}
