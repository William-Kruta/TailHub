/* ==============================================
   network.js  — Peer grid rendering
   ============================================== */
'use strict';

const network = (() => {
  const OS_ICONS = {
    linux: '🐧',
    darwin: '🍎',
    windows: '🪟',
    ios: '📱',
    android: '📱',
  };

  function osIcon(os = '') {
    return OS_ICONS[os.toLowerCase()] || '💻';
  }

  function formatLastSeen(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function render(peers) {
    const grid = document.getElementById('peer-grid');
    grid.innerHTML = '';
    const hideOffline = app.state.preferences.hideOfflinePeers;
    const visiblePeers = hideOffline ? peers.filter(peer => peer.online) : peers;

    if (visiblePeers.length === 0) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:60px 0">
          <p style="font-size:1rem;font-weight:500;color:var(--text)">${peers.length ? 'No online peers' : 'No peers found'}</p>
          <span style="font-size:.85rem">${peers.length ? 'Turn off the offline filter to show every known peer.' : 'Make sure Tailscale is running and you have other devices on your Tailnet.'}</span>
        </div>`;
      return;
    }

    visiblePeers.forEach((peer, i) => {
      const card = document.createElement('div');
      card.className = 'peer-card';
      card.style.animationDelay = `${i * 40}ms`;

      const online = peer.online;
      const lastSeen = online ? '' : formatLastSeen(peer.last_seen);

      card.innerHTML = `
        <div class="peer-top">
          <div class="peer-avatar ${online ? '' : 'offline'}">${peer.display_name.charAt(0).toUpperCase()}</div>
          <div class="status-pill ${online ? 'online' : 'offline'}">
            <span class="status-dot"></span>
            ${online ? 'Online' : 'Offline'}
          </div>
        </div>
        <div>
          <div class="peer-name">${peer.display_name}</div>
          <div class="peer-ip">${peer.tailscale_ip || ''}</div>
          <div class="peer-os" style="display:flex;align-items:center;gap:6px">
            ${osIcon(peer.os)} ${peer.os}${lastSeen ? ' · ' + lastSeen : ''}
            ${online ? `<button class="ping-btn" onclick="network.ping('${peer.display_name}', this)" title="Ping latency">📡</button>` : ''}
            <span class="ping-result"></span>
          </div>
        </div>
        <button
          class="peer-send-btn"
          ${online ? '' : 'disabled'}
          onclick="app.navigate('send'); files.preselectPeer('${peer.display_name}')"
          title="${online ? 'Send a file to ' + peer.display_name : 'Peer is offline'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          Send File
        </button>`;

      grid.appendChild(card);
    });
  }

  async function ping(target, btn) {
    const resSpan = btn.nextElementSibling;
    btn.style.display = 'none';
    resSpan.textContent = 'pinging...';
    resSpan.style.color = 'var(--muted)';

    try {
      const data = await app.api(`/api/ping/${encodeURIComponent(target)}`);
      if (data.error) {
        resSpan.textContent = 'failed';
        resSpan.style.color = 'var(--red)';
      } else {
        const relayText = data.relay ? ' (relay)' : '';
        resSpan.textContent = `${data.latency}${relayText}`;
        resSpan.style.color = data.relay ? '#f59e0b' : 'var(--green)'; // orange if relay, green if direct
      }
    } catch (e) {
      resSpan.textContent = 'error';
      resSpan.style.color = 'var(--red)';
    }
  }

  function filterGrid(query) {
    const q = query.toLowerCase();
    const cards = document.querySelectorAll('#peer-grid .peer-card');
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? 'flex' : 'none';
    });
  }

  return { render, ping, filterGrid };
})();
