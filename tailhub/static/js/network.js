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

  // Stable hue per device name so each machine keeps its own identity.
  function avatarHue(name = '') {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  const OS_LABELS = {
    linux: 'Linux',
    macos: 'macOS',
    darwin: 'macOS',
    windows: 'Windows',
    ios: 'iOS',
    android: 'Android',
  };

  function osLabel(os = '') {
    return OS_LABELS[os.toLowerCase()] || os;
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

  let lastRenderKey = '';

  function render(peers) {
    const grid = document.getElementById('peer-grid');
    const hideOffline = app.state.preferences.hideOfflinePeers;

    // Polling calls render every few seconds — skip the rebuild (and its
    // entry animations) unless something actually changed.
    const renderKey = JSON.stringify(peers) + hideOffline;
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;

    grid.innerHTML = '';
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

      // Static skeleton only — peer-controlled values are set via textContent
      // below to avoid HTML/attribute injection.
      card.innerHTML = `
        <div class="peer-top">
          <div class="peer-avatar"></div>
          <div class="status-pill">
            <span class="status-dot"></span>
            <span class="status-text"></span>
          </div>
        </div>
        <div>
          <div class="peer-name"></div>
          <div class="peer-ip"></div>
          <div class="peer-os" style="display:flex;align-items:center;gap:6px">
            <span class="peer-os-text"></span>
            <button class="ping-btn" title="Ping latency">📡</button>
            <span class="ping-result"></span>
          </div>
        </div>
        <button class="peer-send-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          Send File
        </button>`;

      const avatar = card.querySelector('.peer-avatar');
      avatar.textContent = peer.display_name.charAt(0).toUpperCase();
      avatar.classList.toggle('offline', !online);
      const hue = avatarHue(peer.display_name);
      avatar.style.background =
        `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 72% 46%))`;

      const pill = card.querySelector('.status-pill');
      pill.classList.add(online ? 'online' : 'offline');
      card.querySelector('.status-text').textContent = online ? 'Online' : 'Offline';

      card.querySelector('.peer-name').textContent = peer.display_name;
      const ipEl = card.querySelector('.peer-ip');
      ipEl.textContent = peer.tailscale_ip || '';
      if (peer.tailscale_ip) {
        ipEl.title = 'Copy IP';
        ipEl.addEventListener('click', () => app.copyText(peer.tailscale_ip, 'IP copied'));
      }
      card.querySelector('.peer-os-text').textContent =
        `${osIcon(peer.os)} ${osLabel(peer.os)}${lastSeen ? ' · ' + lastSeen : ''}`;

      const pingBtn = card.querySelector('.ping-btn');
      if (online) {
        pingBtn.addEventListener('click', () => ping(peer.display_name, pingBtn));
      } else {
        pingBtn.remove();
      }

      const sendBtn = card.querySelector('.peer-send-btn');
      sendBtn.disabled = !online;
      sendBtn.title = online ? `Send a file to ${peer.display_name}` : 'Peer is offline';
      sendBtn.addEventListener('click', () => {
        app.navigate('send');
        files.preselectPeer(peer.display_name);
      });

      // Drop a file straight onto an online peer to send it
      if (online) {
        card.addEventListener('dragover', e => {
          e.preventDefault();
          card.classList.add('dragover');
        });
        card.addEventListener('dragleave', () => card.classList.remove('dragover'));
        card.addEventListener('drop', e => {
          e.preventDefault();
          card.classList.remove('dragover');
          files.sendDropped(peer.display_name, e.dataTransfer);
        });
      }

      grid.appendChild(card);
    });

    // Re-apply any active search filter after a rebuild
    const query = document.getElementById('network-search')?.value;
    if (query) filterGrid(query);
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
        resSpan.style.color = data.relay ? 'var(--amber)' : 'var(--green)'; // amber if relay, green if direct
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
