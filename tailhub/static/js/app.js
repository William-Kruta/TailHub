/* ==============================================
   app.js  — Bootstrap, state, routing, toasts
   ============================================== */
'use strict';

const app = (() => {
    // ---- State -------------------------------------------------------
    const state = {
        currentPanel: 'network',
        status: null,       // cached /api/status response
        preferences: {
            panel: localStorage.getItem('tailhub.panel') || 'network',
            hideOfflinePeers: localStorage.getItem('tailhub.hideOfflinePeers') === 'true',
        },
    };

    // ---- Bootstrap ---------------------------------------------------
    async function init() {
        // Accept a token handed over in the URL (e.g. from the QR code),
        // then strip it from the address bar.
        const urlToken = new URLSearchParams(location.search).get('token');
        if (urlToken) {
            localStorage.setItem('tailhub.token', urlToken);
            history.replaceState(null, '', location.pathname);
        }

        document.getElementById('hide-offline-input').checked = state.preferences.hideOfflinePeers;
        const selfIp = document.getElementById('self-ip');
        selfIp.title = 'Copy IP';
        selfIp.addEventListener('click', () => {
            const ip = selfIp.textContent;
            if (ip && ip !== '—' && ip !== 'Offline') copyText(ip, 'IP copied');
        });

        navigate(state.preferences.panel);
        await refresh();

        // Keep the dashboard live: poll status, and check for incoming
        // Taildrop files so they land in the inbox without manual pulls.
        setInterval(() => { if (!document.hidden) refresh({ silent: true }); }, 10000);
        setInterval(() => { if (!document.hidden) files.checkIncoming(); }, 30000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refresh({ silent: true });
        });
    }

    // ---- Data fetch --------------------------------------------------
    async function refresh(options = {}) {
        try {
            const data = await api('/api/status');
            state.status = data;

            // Handle offline state gracefully
            const isRunning = data.self.backend_state === 'Running';
            document.getElementById('offline-overlay').classList.toggle('hidden', isRunning);
            updateOfflineOverlay(data.self.backend_state, data.auth_url);

            const toggleInput = document.getElementById('ts-toggle-input');
            toggleInput.disabled = false;
            toggleInput.checked = isRunning;

            // Update sidebar self-card
            const name = data.self.display_name || data.self.hostname || '?';
            const ip = isRunning ? (data.self.tailscale_ip || '—') : 'Offline';
            document.getElementById('self-name').textContent = name;
            document.getElementById('self-ip').textContent = ip;
            document.getElementById('self-avatar').textContent = name.charAt(0).toUpperCase();
            document.getElementById('self-avatar').classList.toggle('offline', !isRunning);

            // Peer count subtitle
            const n = data.peers.length;
            document.getElementById('peer-count').textContent =
                isRunning ? `${n} peer${n !== 1 ? 's' : ''} on your Tailnet` : 'Tailnet disconnected';

            // Render peer grid
            network.render(data.peers);

            // Populate peer selector in Send panel
            files.populatePeerSelect(data.peers);

        } catch (e) {
            // Background polls fail quietly; only manual refreshes complain.
            if (!options.silent) {
                toast('Could not reach backend — is the TailHub server running?', 'error');
            }
        }
    }

    // ---- Clipboard -----------------------------------------------------
    async function copyText(text, label = 'Copied') {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                // http://100.x.y.z from another device is not a secure context
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            toast(`${label}: ${text}`, 'success');
        } catch (e) {
            toast('Could not copy to clipboard', 'error');
        }
    }

    // ---- Offline overlay ------------------------------------------------
    // "Stopped" is fixable with `tailscale up`; "NeedsLogin" means the node
    // was never authenticated and needs a browser login first.
    function updateOfflineOverlay(backendState, authUrl) {
        const title = document.getElementById('offline-title');
        const message = document.getElementById('offline-message');
        const action = document.getElementById('offline-action');

        if (backendState === 'NeedsLogin') {
            title.textContent = 'Tailscale Needs Login';
            message.textContent = authUrl
                ? 'This device is not logged in to a Tailnet yet. Log in with your browser, then come back and refresh.'
                : 'This device is not logged in to a Tailnet yet. Open the Tailscale app, log in, then refresh.';
            action.textContent = authUrl ? 'Log In to Tailscale' : 'Refresh';
            action.onclick = authUrl
                ? () => window.open(authUrl, '_blank')
                : () => refresh();
        } else {
            title.textContent = 'Tailscale is Disconnected';
            message.textContent = 'Your node is currently offline. Turn Tailscale back on in the sidebar to reconnect to your Tailnet.';
            action.textContent = 'Reconnect Now';
            action.onclick = () => toggleTailscale(true);
        }
    }

    // ---- Tailscale State Toggle --------------------------------------
    async function toggleTailscale(up) {
        const input = document.getElementById('ts-toggle-input');
        input.disabled = true; // prevent spam clicking
        try {
            toast(up ? 'Connecting to Tailnet...' : 'Disconnecting Tailscale...', 'info');
            const res = await api('/api/status/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ up })
            });

            if (res.status === 'needs_login') {
                toast('This device needs to log in to Tailscale first.', 'info');
                input.checked = false;
                input.disabled = false;
                if (res.auth_url) window.open(res.auth_url, '_blank');
                await refresh();
                return;
            }

            // Poll a few times until state changes natively in Tailscale
            setTimeout(refresh, 1500);
            setTimeout(refresh, 3000);
        } catch (err) {
            toast(`Failed to toggle: ${err.message}`, 'error');
            input.disabled = false;
            input.checked = !up; // revert
        }
    }

    // ---- Navigation --------------------------------------------------
    function navigate(panel, options = {}) {
        if (!['network', 'send', 'inbox', 'player'].includes(panel)) panel = 'network';
        state.currentPanel = panel;
        state.preferences.panel = panel;
        localStorage.setItem('tailhub.panel', panel);

        // Toggle panels
        ['network', 'send', 'inbox', 'player'].forEach(id => {
            document.getElementById(`panel-${id}`).classList.toggle('hidden', id !== panel);
        });

        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById(`nav-${panel}`)?.classList.add('active');

        // Lazy-load inbox when navigating to it
        if (panel === 'inbox' && !options.skipLoad) files.loadInbox();
        if (panel === 'player' && !options.skipLoad) player.loadLibrary();
    }

    function setHideOfflinePeers(hidden) {
        state.preferences.hideOfflinePeers = hidden;
        localStorage.setItem('tailhub.hideOfflinePeers', String(hidden));
        if (state.status) network.render(state.status.peers);
    }

    // ---- Toasts -------------------------------------------------------
    function toast(message, type = 'info') {
        const icons = { success: '✓', error: '✕', info: 'ℹ' };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icon = document.createElement('span');
        icon.textContent = icons[type];
        el.appendChild(icon);
        el.appendChild(document.createTextNode(` ${message}`));
        document.getElementById('toast-container').appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    // ---- Auth token ----------------------------------------------------
    function getToken() {
        return localStorage.getItem('tailhub.token') || '';
    }

    // Append the token to URLs used outside fetch() (img/video src, download links).
    function assetUrl(path) {
        const token = getToken();
        if (!token) return path;
        return `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    }

    // ---- Generic API wrapper -----------------------------------------
    async function api(path, options = {}) {
        const headers = new Headers(options.headers || {});
        const token = getToken();
        if (token) headers.set('X-TailHub-Token', token);

        const res = await fetch(path, { ...options, headers });

        if (res.status === 401) {
            const entered = window.prompt('This TailHub server requires an access token (TAILHUB_TOKEN):');
            if (entered && entered.trim()) {
                localStorage.setItem('tailhub.token', entered.trim());
                return api(path, options);
            }
            throw new Error('Access token required');
        }

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // ---- Public -------------------------------------------------------
    window.addEventListener('DOMContentLoaded', init);
    return { navigate, refresh, toggleTailscale, setHideOfflinePeers, toast, api, assetUrl, copyText, state };
})();
