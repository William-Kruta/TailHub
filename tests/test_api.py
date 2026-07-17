"""
Tests for the TailHub API routes and tailscale CLI wrapper.
Run with:  uv run pytest
"""
from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from tailhub import config, tailscale
from tailhub.app import app
from tailhub.routes import files as files_routes


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def download_dir(tmp_path: pathlib.Path, monkeypatch) -> pathlib.Path:
    d = tmp_path / "downloads"
    d.mkdir()
    monkeypatch.setattr(files_routes, "DOWNLOAD_DIR", d)
    return d


# ---------------------------------------------------------------------------
# /api/files/pending — must not crash with multiple files (sorted() on dicts)
# ---------------------------------------------------------------------------

def test_pending_lists_multiple_files(client, download_dir):
    (download_dir / "b.txt").write_text("bbb")
    (download_dir / "a.txt").write_text("aa")

    res = client.get("/api/files/pending")

    assert res.status_code == 200
    names = [f["name"] for f in res.json()["files"]]
    assert names == ["a.txt", "b.txt"]


# ---------------------------------------------------------------------------
# receive_files — must return only newly received files, not old ones
# ---------------------------------------------------------------------------

async def test_receive_returns_only_new_files(tmp_path, monkeypatch):
    download_dir = tmp_path / "downloads"
    download_dir.mkdir()
    (download_dir / "old.txt").write_text("already here")

    async def fake_run(*args):
        # Simulate `tailscale file get` dropping one new file into the dir
        (download_dir / "new.txt").write_text("fresh")
        return "", "", 0

    monkeypatch.setattr(tailscale, "_run", fake_run)

    received = await tailscale.receive_files(download_dir)

    assert received == ["new.txt"]


# ---------------------------------------------------------------------------
# Optional token auth — TAILHUB_TOKEN protects /api/*, static UI stays open
# ---------------------------------------------------------------------------

def test_api_open_when_no_token_configured(client, download_dir, monkeypatch):
    monkeypatch.setattr(config, "TOKEN", "")
    assert client.get("/api/files/pending").status_code == 200


def test_api_rejects_missing_or_wrong_token(client, download_dir, monkeypatch):
    monkeypatch.setattr(config, "TOKEN", "secret")
    assert client.get("/api/files/pending").status_code == 401
    assert (
        client.get("/api/files/pending", headers={"X-TailHub-Token": "nope"}).status_code
        == 401
    )


def test_api_accepts_token_via_header_or_query(client, download_dir, monkeypatch):
    monkeypatch.setattr(config, "TOKEN", "secret")
    assert (
        client.get("/api/files/pending", headers={"X-TailHub-Token": "secret"}).status_code
        == 200
    )
    assert client.get("/api/files/pending?token=secret").status_code == 200


def test_static_ui_open_even_with_token(client, monkeypatch):
    monkeypatch.setattr(config, "TOKEN", "secret")
    assert client.get("/").status_code == 200


# ---------------------------------------------------------------------------
# /api/status/qr — missing IP should surface as 400, not be wrapped in a 500
# ---------------------------------------------------------------------------

def test_qr_returns_400_when_no_ip(client, monkeypatch):
    async def fake_status():
        return tailscale.TailscaleStatus(
            self_node=tailscale.SelfNode(
                dns_name="", tailscale_ip="", os="linux", hostname="me",
                backend_state="Running",
            )
        )

    monkeypatch.setattr(tailscale, "get_status", fake_status)

    assert client.get("/api/status/qr").status_code == 400


# ---------------------------------------------------------------------------
# tailscale CLI resolution — fall back to the macOS app bundle path
# ---------------------------------------------------------------------------

def test_cli_uses_path_binary_when_available(monkeypatch):
    monkeypatch.setattr(tailscale.shutil, "which", lambda _: "/usr/bin/tailscale")
    assert tailscale._tailscale_bin() == "/usr/bin/tailscale"


def test_cli_falls_back_to_bundled_binary(tmp_path, monkeypatch):
    bundled = tmp_path / "Tailscale"
    bundled.write_text("")
    monkeypatch.setattr(tailscale.shutil, "which", lambda _: None)
    monkeypatch.setattr(tailscale, "_CLI_FALLBACKS", (str(bundled),))
    assert tailscale._tailscale_bin() == str(bundled)


def test_cli_defaults_to_bare_name_when_nothing_found(monkeypatch):
    monkeypatch.setattr(tailscale.shutil, "which", lambda _: None)
    monkeypatch.setattr(tailscale, "_CLI_FALLBACKS", ())
    assert tailscale._tailscale_bin() == "tailscale"


# ---------------------------------------------------------------------------
# NeedsLogin handling — `tailscale up` blocks forever when the node was never
# authenticated (macOS fresh install). Toggle must not hang; status must
# surface the auth URL.
# ---------------------------------------------------------------------------

NEEDS_LOGIN_STATUS = tailscale.TailscaleStatus(
    self_node=tailscale.SelfNode(
        dns_name="", tailscale_ip="", os="macOS", hostname="mac",
        backend_state="NeedsLogin",
    ),
    auth_url="https://login.tailscale.com/a/abc123",
)


def test_status_includes_auth_url_when_needs_login(client, monkeypatch):
    import json as jsonlib

    async def fake_run(*args):
        payload = {
            "BackendState": "NeedsLogin",
            "AuthURL": "https://login.tailscale.com/a/abc123",
            "Self": {"HostName": "mac", "OS": "macOS", "TailscaleIPs": []},
            "Peer": {},
        }
        return jsonlib.dumps(payload), "", 0

    monkeypatch.setattr(tailscale, "_run", fake_run)

    res = client.get("/api/status")
    assert res.status_code == 200
    body = res.json()
    assert body["self"]["backend_state"] == "NeedsLogin"
    assert body["auth_url"] == "https://login.tailscale.com/a/abc123"


def test_toggle_up_reports_needs_login_instead_of_hanging(client, monkeypatch):
    async def fake_status():
        return NEEDS_LOGIN_STATUS

    async def fail_if_run(*args):
        raise AssertionError(f"tailscale {' '.join(args)} must not run when NeedsLogin")

    monkeypatch.setattr(tailscale, "get_status", fake_status)
    monkeypatch.setattr(tailscale, "_run", fail_if_run)

    res = client.post("/api/status/toggle", json={"up": True})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "needs_login"
    assert body["auth_url"] == "https://login.tailscale.com/a/abc123"


def test_toggle_up_times_out_instead_of_hanging_forever(client, monkeypatch):
    import asyncio

    async def fake_status():
        return tailscale.TailscaleStatus(
            self_node=tailscale.SelfNode(
                dns_name="", tailscale_ip="", os="macOS", hostname="mac",
                backend_state="Stopped",
            )
        )

    async def hanging_run(*args):
        await asyncio.sleep(5)
        return "", "", 0

    monkeypatch.setattr(tailscale, "get_status", fake_status)
    monkeypatch.setattr(tailscale, "_run", hanging_run)
    monkeypatch.setattr(tailscale, "TOGGLE_TIMEOUT", 0.05)

    res = client.post("/api/status/toggle", json={"up": True})
    assert res.status_code == 500
    assert "timed out" in res.json()["detail"]
