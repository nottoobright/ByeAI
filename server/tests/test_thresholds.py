"""Threshold floors are env-configurable; viewCount==0 triggers a YouTube API lookup."""
import main


VALID_HASH = "11111111-1111-4111-8111-111111111111"
VALID_VIDEO = "abcdefghijk"
VALID_CHANNEL = "UCabcdefghijklmnopqrstuv"


def test_video_threshold_default_floor(monkeypatch):
    monkeypatch.delenv("VIDEO_THRESHOLD_FLOOR", raising=False)
    assert main.calculate_threshold(0) == 15


def test_video_threshold_env_floor(monkeypatch):
    monkeypatch.setenv("VIDEO_THRESHOLD_FLOOR", "3")
    assert main.calculate_threshold(0) == 3
    # large videos still follow the sqrt formula
    assert main.calculate_threshold(10_000_000) == 159


def test_video_threshold_malformed_env_falls_back(monkeypatch):
    monkeypatch.setenv("VIDEO_THRESHOLD_FLOOR", "abc")
    assert main.calculate_threshold(0) == 15


def test_channel_threshold_malformed_env_falls_back(monkeypatch):
    monkeypatch.setenv("CHANNEL_FLAG_THRESHOLD", "3.5")
    assert main.get_channel_flag_threshold() == 10


def test_channel_threshold_env(client, monkeypatch):
    monkeypatch.setenv("CHANNEL_FLAG_THRESHOLD", "2")
    for h in ("aaaaaaaa-1111-4111-8111-111111111111",
              "bbbbbbbb-1111-4111-8111-111111111111"):
        resp = client.post("/channel/vote", json={
            "channelId": VALID_CHANNEL, "category": "ai-script",
            "clientHash": h, "timestamp": 1700000000000,
        })
        assert resp.status_code == 200
    resp = client.get(f"/channels?ids={VALID_CHANNEL}")
    assert [c["id"] for c in resp.json()["channels"]] == [VALID_CHANNEL]


def test_vote_with_zero_viewcount_uses_api_lookup(client, monkeypatch):
    async def fake_view_count(video_id):
        return 5_000_000
    monkeypatch.setattr(main.youtube_service, "get_view_count", fake_view_count)
    resp = client.post("/vote", json={
        "videoId": VALID_VIDEO, "category": "ai-voice",
        "clientHash": VALID_HASH, "timestamp": 1700000000000,
        "viewCount": 0, "flagSource": "popup",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["view_count_source"] == "api"
    assert body["threshold"] == main.calculate_threshold(5_000_000)


def test_vote_with_dom_viewcount_skips_lookup(client, monkeypatch):
    async def boom(video_id):
        raise AssertionError("must not call the YouTube API when viewCount > 0")
    monkeypatch.setattr(main.youtube_service, "get_view_count", boom)
    resp = client.post("/vote", json={
        "videoId": "zyxwvutsrqp", "category": "ai-voice",
        "clientHash": VALID_HASH, "timestamp": 1700000000000,
        "viewCount": 12345, "flagSource": "inline_button",
    })
    assert resp.status_code == 200
    assert resp.json()["view_count_source"] == "dom"
