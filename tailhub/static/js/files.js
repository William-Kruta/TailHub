/* ==============================================
   files.js  — Send panel + Inbox panel logic
   ============================================== */
'use strict';

const files = (() => {
    let selectedFiles = [];
    let selectedArchiveName = null;
    let sendMode = localStorage.getItem('tailhub.sendMode') || 'file'; // 'file' or 'data'

    // ---- Peer selector population ------------------------------------
    function populatePeerSelect(peers) {
        const sel = document.getElementById('target-select');
        const prev = sel.value;
        sel.innerHTML = '<option value="">Select a peer…</option>';
        peers.forEach(p => {
            if (!p.online) return;  // only online peers can receive
            const opt = document.createElement('option');
            opt.value = p.display_name;
            opt.textContent = `${p.display_name}  (${p.tailscale_ip})`;
            sel.appendChild(opt);
        });
        // Restore previous selection if peer still there
        if (prev) sel.value = prev;
        updateSendBtn();
    }

    function preselectPeer(name) {
        document.getElementById('target-select').value = name;
        updateSendBtn();
    }

    // ---- Drag & Drop / file input ------------------------------------
    function initDropZone() {
        const zone = document.getElementById('drop-zone');
        const input = document.getElementById('file-input');

        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', async e => {
            e.preventDefault();
            zone.classList.remove('dragover');
            const droppedFiles = await collectDroppedFiles(e.dataTransfer);
            if (droppedFiles.length) setFiles(droppedFiles);
        });
        zone.addEventListener('click', e => {
            if (e.target.classList.contains('file-link') || e.target === input) return;
            input.click();
        });
        input.addEventListener('change', () => {
            if (input.files.length) setFiles(input.files);
        });

        // Bind data input change events
        document.getElementById('data-input').addEventListener('input', updateSendBtn);
        document.getElementById('target-select').addEventListener('change', updateSendBtn);
    }

    // ---- Mode handling -----------------------------------------------
    function setMode(mode) {
        if (!['file', 'data'].includes(mode)) mode = 'file';
        sendMode = mode;
        localStorage.setItem('tailhub.sendMode', mode);
        document.getElementById('mode-file').classList.toggle('active', mode === 'file');
        document.getElementById('mode-data').classList.toggle('active', mode === 'data');
        document.getElementById('drop-zone').classList.toggle('hidden', mode !== 'file');
        document.getElementById('data-zone').classList.toggle('hidden', mode !== 'data');
        updateSendBtn();
    }

    function setFiles(fileList) {
        selectedFiles = Array.from(fileList);
        document.getElementById('drop-icon')?.style && (document.querySelector('.drop-icon').style.display = 'none');
        document.querySelector('.drop-label').style.display = 'none';
        document.querySelector('.drop-sub').style.display = 'none';

        const preview = document.getElementById('file-preview');
        if (selectedFiles.length === 1) {
            selectedArchiveName = null;
            const file = selectedFiles[0];
            document.getElementById('preview-name').textContent = file.name;
            document.getElementById('preview-size').textContent = formatBytes(file.size);

            const ext = file.name.split('.').pop().toLowerCase();
            const icons = {
                jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
                mp4: '🎬', mkv: '🎬', mov: '🎬',
                mp3: '🎵', wav: '🎵', flac: '🎵',
                pdf: '📄', zip: '🗜️', tar: '🗜️', gz: '🗜️',
                py: '🐍', js: '📜', txt: '📝'
            };
            document.querySelector('.file-icon').textContent = icons[ext] || '📄';
        } else {
            selectedArchiveName = archiveName();
            document.getElementById('preview-name').textContent = `${selectedFiles.length} files selected`;
            const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
            document.getElementById('preview-size').textContent = `${selectedArchiveName}.zip · Total payload: ${formatBytes(totalSize)}`;
            document.querySelector('.file-icon').textContent = '🗂️';
        }

        preview.style.display = 'flex';
        updateSendBtn();
    }

    function clearFile() {
        selectedFiles = [];
        selectedArchiveName = null;
        document.getElementById('file-preview').style.display = 'none';
        document.querySelector('.drop-label').style.display = '';
        document.querySelector('.drop-sub').style.display = '';
        document.getElementById('file-input').value = '';

        // Clear data mode too
        document.getElementById('data-input').value = '';
        updateSendBtn();
    }

    function updateSendBtn() {
        const target = document.getElementById('target-select').value;
        let hasPayload = false;

        if (sendMode === 'file') {
            hasPayload = selectedFiles.length > 0;
        } else {
            hasPayload = document.getElementById('data-input').value.trim().length > 0;
        }

        document.getElementById('send-btn').disabled = !(hasPayload && target);
    }

    // ---- Send --------------------------------------------------------
    async function sendFile() {
        const target = document.getElementById('target-select').value;
        if (!target) return;

        let payloadFiles = [];
        if (sendMode === 'file') {
            if (!selectedFiles.length) return;
            payloadFiles = selectedFiles;
        } else {
            const text = document.getElementById('data-input').value.trim();
            if (!text) return;
            // Convert raw text into a file object securely in memory
            const blob = new Blob([text], { type: 'text/plain' });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            payloadFiles = [new File([blob], `TailHub_Data_${timestamp}.txt`, { type: 'text/plain' })];
        }

        const btn = document.getElementById('send-btn');
        const progressWrap = document.getElementById('progress-wrap');
        const progressFill = document.getElementById('progress-fill');
        const progressLabel = document.getElementById('progress-label');

        btn.disabled = true;
        progressWrap.style.display = 'block';
        progressFill.style.width = '15%';
        const payloadArchiveName = selectedArchiveName || archiveName();
        const displayName = payloadFiles.length === 1 ? `"${payloadFiles[0].name}"` : `"${payloadArchiveName}.zip"`;
        progressLabel.textContent = `Sending ${displayName} to ${target}…`;

        const form = new FormData();
        for (const f of payloadFiles) {
            form.append('files', f);
            form.append('relative_paths', f.tailhubRelativePath || f.webkitRelativePath || f.name);
        }
        if (payloadFiles.length > 1) {
            form.append('archive_name', payloadArchiveName);
        }
        form.append('target', target);

        // Fake incremental progress (true streaming isn't trivial without SSE)
        const interval = setInterval(() => {
            const cur = parseFloat(progressFill.style.width);
            if (cur < 85) progressFill.style.width = `${cur + 5}%`;
        }, 400);

        try {
            await app.api('/api/files/send', { method: 'POST', body: form });
            clearInterval(interval);
            progressFill.style.width = '100%';
            progressLabel.textContent = '✓ Sent successfully!';
            app.toast(`Sent ${displayName} to ${target}`, 'success');
            setTimeout(() => {
                progressWrap.style.display = 'none';
                clearFile();
                btn.disabled = false;
            }, 2000);
        } catch (err) {
            clearInterval(interval);
            progressLabel.textContent = `Error: ${err.message}`;
            progressFill.style.width = '100%';
            progressFill.style.background = 'var(--red)';
            app.toast(`Send failed: ${err.message}`, 'error');
            setTimeout(() => {
                progressWrap.style.display = 'none';
                progressFill.style.background = '';
                btn.disabled = false;
            }, 3000);
        }
    }

    // ---- Inbox -------------------------------------------------------
    async function loadInbox() {
        try {
            const data = await app.api('/api/files/pending');
            document.getElementById('inbox-dir').textContent = `📁 ${data.download_dir}`;

            const list = document.getElementById('file-list');
            const empty = document.getElementById('inbox-empty');
            list.innerHTML = '';
            list.appendChild(empty);

            if (data.files.length === 0) {
                empty.style.display = 'flex';
                updateInboxBadge(0);
                return;
            }

            empty.style.display = 'none';
            updateInboxBadge(data.files.length);

            data.files.forEach((f, i) => {
                const row = document.createElement('div');
                row.className = 'file-row';
                row.style.animationDelay = `${i * 30}ms`;
                const ext = f.name.split('.').pop().toLowerCase();
                const icons = { jpg: '🖼️', jpeg: '🖼️', png: '🖼️', pdf: '📄', zip: '🗜️', mp4: '🎬', mp3: '🎵', txt: '📝', json: '📝', md: '📝', py: '🐍', js: '📜' };
                const safeName = escapeHtml(f.name);
                row.innerHTML = `
          <div class="file-row-icon">${icons[ext] || '📄'}</div>
          <div class="file-row-meta">
            <div class="file-row-name">${safeName}</div>
            <div class="file-row-size">${formatBytes(f.size)}</div>
          </div>
          <button class="file-delete-btn" type="button" title="Delete ${safeName}" aria-label="Delete ${safeName}">✕</button>`;

                // Click to preview/download if supported
                row.style.cursor = 'pointer';
                row.title = "Click to preview or download";
                row.addEventListener('click', () => openPreview(f.name, ext));
                row.querySelector('.file-delete-btn').addEventListener('click', event => {
                    event.stopPropagation();
                    deleteFile(f.name);
                });

                list.appendChild(row);
            });
        } catch (e) {
            app.toast(`Could not load inbox: ${e.message}`, 'error');
        }
    }

    async function receiveFiles() {
        app.toast('Pulling pending transfers…', 'info');
        try {
            const data = await app.api('/api/files/receive', { method: 'POST' });
            const n = data.received.length;
            app.toast(n > 0 ? `Received ${n} file${n !== 1 ? 's' : ''}` : 'No pending files', n > 0 ? 'success' : 'info');
            await loadInbox();
        } catch (e) {
            app.toast(`Receive failed: ${e.message}`, 'error');
        }
    }

    // ---- Previews ----------------------------------------------------
    async function openPreview(filename, ext) {
        const modal = document.getElementById('preview-modal');
        const body = document.getElementById('preview-body');
        const url = `/api/files/download/${encodeURIComponent(filename)}`;
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const textExts = ['txt', 'json', 'md', 'py', 'js', 'html', 'css', 'csv', 'yaml', 'toml', 'sh'];
        const videoExts = ['mp4', 'webm'];

        modal.classList.remove('hidden');
        body.innerHTML = 'Loading...';

        if (imageExts.includes(ext)) {
            body.innerHTML = `<img src="${url}" alt="${filename}">`;
        } else if (videoExts.includes(ext)) {
            body.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%;max-height:80vh;"></video>`;
        } else if (textExts.includes(ext)) {
            try {
                const res = await fetch(url);
                const text = await res.text();
                const pre = document.createElement('pre');
                pre.textContent = text;
                body.innerHTML = '';
                body.appendChild(pre);
            } catch (e) {
                body.innerHTML = `<p style="color:var(--red)">Failed to load text snippet: ${e.message}</p>`;
            }
        } else {
            // Fallback: Show a download button for unsupported preview types
            body.innerHTML = `
        <div style="text-align:center;color:white;">
           <span style="font-size:3rem;">📄</span>
           <h3 style="margin:16px 0">${filename}</h3>
           <p style="color:var(--muted)">Preview not supported for this file type.</p>
           <a href="${url}" download="${filename}" class="dw-btn">Download File</a>
        </div>
      `;
        }
    }

    function closePreview() {
        document.getElementById('preview-modal').classList.add('hidden');
        document.getElementById('preview-body').innerHTML = ''; // halt video if playing
    }

    async function deleteFile(filename) {
        if (!confirm(`Delete "${filename}" from the TailHub inbox?`)) return;
        try {
            await app.api(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            app.toast(`Deleted ${filename}`, 'success');
            await loadInbox();
        } catch (e) {
            app.toast(`Delete failed: ${e.message}`, 'error');
        }
    }

    function showQR() {
        const modal = document.getElementById('preview-modal');
        const body = document.getElementById('preview-body');
        const ip = document.getElementById('self-ip').textContent;

        modal.classList.remove('hidden');
        body.innerHTML = `
          <div style="text-align:center; color:white; padding: 20px;">
            <h3 style="margin-bottom:12px;">Mobile Connect</h3>
            <p style="color:var(--muted); font-size:.85rem; margin-bottom:20px;">
              Scan to open TailHub on your iPhone.<br>
              Must be connected to your Tailnet.
            </p>
            <div style="background:white; padding:12px; border-radius:12px; display:inline-block;">
              <img src="/api/status/qr?t=${Date.now()}" style="width:240px; height:240px; border-radius:0;">
            </div>
            <div style="margin-top:20px; font-family:monospace; color:var(--accent);">${ip}</div>
          </div>
        `;
    }

    // ---- Helpers -----------------------------------------------------
    function updateInboxBadge(n) {
        const badge = document.getElementById('inbox-badge');
        badge.textContent = n;
        badge.style.display = n > 0 ? 'flex' : 'none';
    }

    function formatBytes(b) {
        if (!b) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function archiveName() {
        const now = new Date();
        const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
        return `TailHub_Archive_${stamp}`;
    }

    async function collectDroppedFiles(dataTransfer) {
        const items = Array.from(dataTransfer.items || []);
        const entries = items
            .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
            .filter(Boolean);

        if (!entries.length) return Array.from(dataTransfer.files || []);

        const files = [];
        for (const entry of entries) {
            await readEntry(entry, '', files);
        }
        return files;
    }

    async function readEntry(entry, prefix, files) {
        if (entry.isFile) {
            const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
            file.tailhubRelativePath = `${prefix}${file.name}`;
            files.push(file);
            return;
        }

        if (!entry.isDirectory) return;

        const nextPrefix = `${prefix}${entry.name}/`;
        const reader = entry.createReader();
        let batch = [];
        do {
            batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            for (const child of batch) {
                await readEntry(child, nextPrefix, files);
            }
        } while (batch.length > 0);
    }

    // ---- Init --------------------------------------------------------
    window.addEventListener('DOMContentLoaded', () => {
        initDropZone();
        setMode(sendMode);
    });

    return { populatePeerSelect, preselectPeer, setMode, sendFile, clearFile, loadInbox, receiveFiles, closePreview, showQR };
})();
