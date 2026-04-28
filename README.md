# TailHub

TailHub is a local web interface for sending and receiving files over
[Tailscale Taildrop](https://tailscale.com/kb/1106/taildrop). It wraps the
`tailscale` CLI with a FastAPI backend and serves a small browser UI for
viewing your Tailnet, sending files to online peers, pulling incoming Taildrop
files, and previewing downloaded files.

## Features

- Tailnet status dashboard with local node and peer details.
- Online/offline peer list with search and quick send actions.
- Send one file, multiple files, dropped folders, or raw text data through Taildrop.
- Multiple selected files and dropped folders are automatically zipped before sending.
- Inbox view for files received via Taildrop.
- Image, video, and text previews for downloaded files.
- QR code for opening TailHub from another device on your Tailnet.
- Optional systemd user service installer.

## Requirements

- Python 3.12 or newer.
- [`uv`](https://docs.astral.sh/uv/) for dependency management and running the
  app.
- Tailscale installed, logged in, and available as the `tailscale` CLI.
- Taildrop enabled for the devices you want to transfer between.

For sending files from TailHub, Tailscale may require operator permissions:

```bash
sudo tailscale set --operator=$USER
```

## Install

Clone or enter this repository, then install the Python dependencies:

```bash
uv sync
```

## Run

Start the local server:

```bash
./run.sh
```

Or run it directly:

```bash
uv run python main.py
```

Open the UI at:

```text
http://127.0.0.1:8080
```

The app can also be served with reload during development:

```bash
uv run uvicorn tailhub.app:app --reload
```

To install a terminal alias so TailHub can be started with `tailhub`, run:

```bash
./alias.sh
source ~/.bashrc
```

If you use zsh, reload `~/.zshrc` instead. The script also accepts an explicit
shell config path:

```bash
./alias.sh ~/.zshrc
```

## Configuration

TailHub reads these environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `TAILHUB_HOST` | `127.0.0.1` | Host/interface the FastAPI server binds to. |
| `TAILHUB_PORT` | `8080` | Port for the web UI and API. |
| `TAILHUB_DOWNLOAD_DIR` | `~/Downloads/TailHub` | Directory where received Taildrop files are stored. |

Example:

```bash
TAILHUB_HOST=0.0.0.0 TAILHUB_PORT=8080 TAILHUB_DOWNLOAD_DIR="$HOME/Downloads/TailHub" uv run python main.py
```

When exposing TailHub to other Tailnet devices, bind to an interface those
devices can reach, for example `TAILHUB_HOST=0.0.0.0`, and open:

```text
http://<your-tailscale-ip>:8080
```

## Systemd User Service

On Linux systems with systemd user services, install and start TailHub with:

```bash
./install.sh
```

The installer creates:

```text
~/.config/systemd/user/tailhub.service
```

Useful service commands:

```bash
systemctl --user status tailhub.service
journalctl --user -u tailhub.service -f
systemctl --user restart tailhub.service
```

## API

TailHub exposes these local API endpoints:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Return local Tailscale node details and peer list. |
| `POST` | `/api/status/toggle` | Run `tailscale up` or `tailscale down`. Body: `{"up": true}`. |
| `GET` | `/api/status/qr` | Return a PNG QR code for the local TailHub URL. |
| `GET` | `/api/ping/{target}` | Ping a peer with `tailscale ping -c 1`. |
| `POST` | `/api/files/send` | Upload one or more files and send them to a peer with Taildrop. |
| `POST` | `/api/files/receive` | Pull pending incoming Taildrop files into the download directory. |
| `GET` | `/api/files/pending` | List files currently in the download directory. |
| `GET` | `/api/files/download/{filename}` | Download or preview a received file. |
| `DELETE` | `/api/files/{filename}` | Delete a received file from the download directory. |

The interactive API docs are available at:

```text
http://127.0.0.1:8080/api/docs
```

Example file send request:

```bash
curl -F "files=@example.txt" -F "target=my-peer" http://127.0.0.1:8080/api/files/send
```

## Project Layout

```text
main.py                    # Application entry point
tailhub/app.py             # FastAPI app setup and static frontend mount
tailhub/config.py          # Runtime configuration
tailhub/tailscale.py       # Async wrapper around the tailscale CLI
tailhub/routes/status.py   # Status, QR, toggle, and ping routes
tailhub/routes/files.py    # Send, receive, list, and download routes
tailhub/static/            # HTML, CSS, and JavaScript frontend
run.sh                     # Local development runner
alias.sh                   # Installs a tailhub shell alias
install.sh                 # systemd user service installer
send_demo.py               # Example script for calling the send API
```

## Troubleshooting

If the UI cannot reach the backend, make sure the server is running and that
you opened the same host and port shown at startup.

If `/api/status` fails, confirm that Tailscale is installed, authenticated, and
working from the terminal:

```bash
tailscale status --json
```

If sending fails with a permissions error, run:

```bash
sudo tailscale set --operator=$USER
```

If another Tailnet device cannot open TailHub, bind the server to a reachable
interface:

```bash
TAILHUB_HOST=0.0.0.0 uv run python main.py
```
