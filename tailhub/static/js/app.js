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
        document.getElementById('hide-offline-input').checked = state.preferences.hideOfflinePeers;
        navigate(state.preferences.panel);
        await refresh();
    }

    // ---- Data fetch --------------------------------------------------
    async function refresh() {
        try {
            const data = await api('/api/status');
            state.status = data;

            // Handle offline state gracefully
            const isRunning = data.self.backend_state === 'Running';
            document.getElementById('offline-overlay').classList.toggle('hidden', isRunning);

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
            toast('Could not reach backend — is the TailHub server running?', 'error');
        }
    }

    // ---- Tailscale State Toggle --------------------------------------
    async function toggleTailscale(up) {
        const input = document.getElementById('ts-toggle-input');
        input.disabled = true; // prevent spam clicking
        try {
            toast(up ? 'Connecting to Tailnet...' : 'Disconnecting Tailscale...', 'info');
            await api('/api/status/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ up })
            });
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
        if (!['network', 'send', 'inbox'].includes(panel)) panel = 'network';
        state.currentPanel = panel;
        state.preferences.panel = panel;
        localStorage.setItem('tailhub.panel', panel);

        // Toggle panels
        ['network', 'send', 'inbox'].forEach(id => {
            document.getElementById(`panel-${id}`).classList.toggle('hidden', id !== panel);
        });

        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById(`nav-${panel}`)?.classList.add('active');

        // Lazy-load inbox when navigating to it
        if (panel === 'inbox' && !options.skipLoad) files.loadInbox();
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
        el.innerHTML = `<span>${icons[type]}</span> ${message}`;
        document.getElementById('toast-container').appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    // ---- Generic API wrapper -----------------------------------------
    async function api(path, options = {}) {
        const res = await fetch(path, options);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // ---- Public -------------------------------------------------------
    window.addEventListener('DOMContentLoaded', init);
    return { navigate, refresh, toggleTailscale, setHideOfflinePeers, toast, api, state };
})();
