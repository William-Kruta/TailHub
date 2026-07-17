"""
tailhub/tailscale.py
Async wrapper around the `tailscale` CLI binary.
All subprocess calls use argument lists (no shell=True) to prevent injection.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import re
import shutil
from dataclasses import dataclass, field
from typing import Any

# Locations to try when `tailscale` is not on PATH (macOS app bundle).
_CLI_FALLBACKS = (
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
)


def _tailscale_bin() -> str:
    """Resolve the tailscale CLI binary, preferring PATH."""
    found = shutil.which("tailscale")
    if found:
        return found
    for candidate in _CLI_FALLBACKS:
        if pathlib.Path(candidate).is_file():
            return candidate
    return "tailscale"


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Peer:
    dns_name: str
    tailscale_ip: str
    os: str
    online: bool
    last_seen: str
    hostname: str

    @property
    def display_name(self) -> str:
        """Short friendly name (strip the trailing tailnet domain)."""
        return self.dns_name.split(".")[0] if self.dns_name else self.hostname


@dataclass
class SelfNode:
    dns_name: str
    tailscale_ip: str
    os: str
    hostname: str
    backend_state: str  # e.g., "Running", "Stopped", "NeedsLogin"


@dataclass
class TailscaleStatus:
    self_node: SelfNode
    peers: list[Peer] = field(default_factory=list)
    # Login URL reported by tailscaled when backend_state == "NeedsLogin"
    auth_url: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _run(*args: str) -> tuple[str, str, int]:
    """Run a tailscale subcommand and return (stdout, stderr, returncode)."""
    proc = await asyncio.create_subprocess_exec(
        _tailscale_bin(),
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return stdout.decode(), stderr.decode(), proc.returncode


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_status() -> TailscaleStatus:
    """Parse `tailscale status --json` into a TailscaleStatus object."""
    stdout, stderr, code = await _run("status", "--json")

    if code != 0:
        raise RuntimeError(f"tailscale status failed: {stderr.strip()}")

    data: dict[str, Any] = json.loads(stdout)

    me = data.get("Self", {})
    self_node = SelfNode(
        dns_name=me.get("DNSName", ""),
        tailscale_ip=me.get("TailscaleIPs", [""])[0] if me.get("TailscaleIPs") else "",
        os=me.get("OS", "unknown"),
        hostname=me.get("HostName", ""),
        backend_state=data.get("BackendState", "Unknown"),
    )

    peers: list[Peer] = []
    for peer_data in (data.get("Peer") or {}).values():
        peers.append(
            Peer(
                dns_name=peer_data.get("DNSName", ""),
                tailscale_ip=peer_data.get("TailscaleIPs", [""])[0],
                os=peer_data.get("OS", "unknown"),
                online=peer_data.get("Online", False),
                last_seen=peer_data.get("LastSeen", ""),
                hostname=peer_data.get("HostName", ""),
            )
        )

    # Sort: online peers first, then alphabetically
    peers.sort(key=lambda p: (not p.online, p.display_name.lower()))

    return TailscaleStatus(
        self_node=self_node,
        peers=peers,
        auth_url=data.get("AuthURL", "") or "",
    )


async def send_file(filepath: pathlib.Path, target: str) -> None:
    """
    Send a file to a Tailscale peer using `tailscale file cp`.
    `target` is the peer's hostname or DNS name (without colon).
    """
    # Trailing colon is required by tailscale file cp
    stdout, stderr, code = await _run("file", "cp", str(filepath), f"{target}:")
    if code != 0:
        raise RuntimeError(f"tailscale file cp failed: {stderr.strip()}")


async def receive_files(download_dir: pathlib.Path) -> list[str]:
    """
    Pull pending incoming files into `download_dir` without blocking
    (`--wait=false`). Returns only the filenames that newly arrived.
    """
    download_dir.mkdir(parents=True, exist_ok=True)
    before = {f.name for f in download_dir.iterdir() if f.is_file()}

    stdout, stderr, code = await _run(
        "file", "get", "--wait=false", str(download_dir)
    )
    # tailscale file get returns 0 even when there are no files.
    if code != 0 and "no files" not in stderr.lower():
        raise RuntimeError(f"tailscale file get failed: {stderr.strip()}")

    after = {f.name for f in download_dir.iterdir() if f.is_file()}
    return sorted(after - before)


# `tailscale up` normally returns in a couple of seconds; if the node is not
# authenticated it blocks forever waiting for a browser login, so cap it.
TOGGLE_TIMEOUT = 30.0


async def toggle_state(up: bool) -> dict[str, Any]:
    """
    Run `tailscale up` or `tailscale down`.

    If the node has never been authenticated (BackendState == "NeedsLogin"),
    `tailscale up` would block forever waiting for a browser login — so we
    return {"needs_login": True, "auth_url": ...} instead of running it.
    """
    if up:
        status = await get_status()
        if status.self_node.backend_state == "NeedsLogin":
            return {"needs_login": True, "auth_url": status.auth_url}

    cmd = "up" if up else "down"
    try:
        stdout, stderr, code = await asyncio.wait_for(_run(cmd), TOGGLE_TIMEOUT)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"tailscale {cmd} timed out — the node may need to be logged in first"
        )
    if code != 0:
        raise RuntimeError(f"tailscale {cmd} failed: {stderr.strip()}")
    return {"needs_login": False}


async def ping(target: str) -> dict[str, Any]:
    """Run `tailscale ping -c 1 <target>` to get latency and transport type."""
    # Timeout after 4s if ping hangs
    try:
        proc = await asyncio.create_subprocess_exec(
            _tailscale_bin(), "ping", "-c", "1", f"{target}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=4.0)
        stdout = stdout_bytes.decode()
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {"target": target, "latency": "timeout", "relay": False, "error": "timeout"}

    if proc.returncode != 0:
        return {"target": target, "latency": "error", "relay": False, "error": "failed"}

    out = stdout.lower()
    latency = "?"
    relay = "via derp" in out

    match = re.search(r"in\s+([\d\.]+ms)", out)
    if match:
        latency = match.group(1)

    return {"target": target, "latency": latency, "relay": relay, "error": None}
