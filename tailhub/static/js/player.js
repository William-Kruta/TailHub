/* ==============================================
   player.js  — Video Player panel: play inbox or local media
   ============================================== */
'use strict';

const player = (() => {
    const VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv'];
    const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus'];
    let current = null;     // inbox filename playing, null for local files
    let objectUrl = null;   // blob URL for a local file, revoked when replaced

    function mediaKind(name) {
        const ext = name.split('.').pop().toLowerCase();
        if (VIDEO_EXTS.includes(ext)) return 'video';
        if (AUDIO_EXTS.includes(ext)) return 'audio';
        return null;
    }

    // ---- Inbox media list --------------------------------------------
    async function loadLibrary() {
        try {
            const data = await app.api('/api/files/pending');
            const media = data.files
                .filter(f => mediaKind(f.name))
                .sort((a, b) => b.modified - a.modified);

            const list = document.getElementById('player-list');
            list.innerHTML = '';
            if (!media.length) {
                const empty = document.createElement('p');
                empty.className = 'player-list-empty';
                empty.textContent = 'No video or audio files in your inbox yet.';
                list.appendChild(empty);
                return;
            }

            media.forEach((f, i) => {
                const row = document.createElement('div');
                row.className = 'file-row';
                row.style.animationDelay = `${i * 30}ms`;
                row.style.cursor = 'pointer';
                row.dataset.name = f.name;
                row.title = `Play ${f.name}`;
                row.innerHTML = `
          <div class="file-row-icon">${mediaKind(f.name) === 'video' ? '🎬' : '🎵'}</div>
          <div class="file-row-meta">
            <div class="file-row-name"></div>
            <div class="file-row-size">${formatBytes(f.size)}</div>
          </div>`;
                row.querySelector('.file-row-name').textContent = f.name;
                row.addEventListener('click', () => playInbox(f.name));
                list.appendChild(row);
            });
            highlightCurrent();
        } catch (e) {
            app.toast(`Could not load media: ${e.message}`, 'error');
        }
    }

    function highlightCurrent() {
        document.querySelectorAll('#player-list .file-row').forEach(row => {
            row.classList.toggle('playing', row.dataset.name === current);
        });
    }

    // ---- Playback ----------------------------------------------------
    function playInbox(name) {
        current = name;
        play(name, mediaKind(name), app.assetUrl(`/api/files/download/${encodeURIComponent(name)}`));
        highlightCurrent();
    }

    function openLocal() {
        document.getElementById('player-input').click();
    }

    function playLocal(file) {
        const kind = file.type.startsWith('video/') ? 'video'
            : file.type.startsWith('audio/') ? 'audio'
                : mediaKind(file.name);
        if (!kind) {
            app.toast(`"${file.name}" is not a video or audio file`, 'error');
            return;
        }
        current = null;
        play(file.name, kind, file);
        highlightCurrent();
    }

    // source is a URL, or a File picked from this device
    function play(name, kind, source) {
        stop();
        if (source instanceof File) source = objectUrl = URL.createObjectURL(source);

        const media = document.createElement(kind);
        media.controls = true;
        media.autoplay = true;
        media.src = source;
        media.addEventListener('error', () => {
            // Ignore errors from an element we already swapped out
            if (media.isConnected) app.toast(`This browser can't play "${name}"`, 'error');
        });

        const stage = document.getElementById('player-stage');
        stage.classList.toggle('audio', kind === 'audio');
        if (kind === 'audio') {
            const card = document.createElement('div');
            card.className = 'player-audio';
            const icon = document.createElement('div');
            icon.className = 'player-audio-icon';
            icon.textContent = '🎵';
            const title = document.createElement('div');
            title.className = 'player-audio-title';
            title.textContent = name;
            card.append(icon, title, media);
            stage.appendChild(card);
        } else {
            stage.appendChild(media);
        }
        document.getElementById('player-now').textContent = `Now playing: ${name}`;
    }

    // Halt the current element so it stops downloading, then clear the stage.
    function stop() {
        const stage = document.getElementById('player-stage');
        const old = stage.querySelector('video, audio');
        if (old) {
            old.pause();
            old.removeAttribute('src');
            old.load();
        }
        stage.innerHTML = '';
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    }

    // ---- Helpers -----------------------------------------------------
    function formatBytes(b) {
        if (!b) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    }

    // ---- Init --------------------------------------------------------
    window.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('player-input');
        input.addEventListener('change', () => {
            if (input.files.length) playLocal(input.files[0]);
            input.value = '';
        });
    });

    return { loadLibrary, openLocal };
})();
