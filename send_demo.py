import urllib.request
import urllib.parse
import json
import pathlib
import uuid

# 1. Create a dummy data file that an external app might generate
data_file = pathlib.Path("app_export_data.json")
data_file.write_text('{"event": "db_sync", "status": "success", "count": 42}')
print(f"Created file: {data_file.name}")

# 2. Define the TailHub endpoint and target peer
url = "http://127.0.0.1:8080/api/files/send"
target_peer = "iphone-15-plus"  # Or another peer from the GUI

print(f"Sending via TailHub to {target_peer}...")

# 3. Make the API call using standard library (multipart upload)
boundary = uuid.uuid4().hex

with open(data_file, "rb") as f:
    file_content = f.read()

# Build the multipart body
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="files"; filename="{data_file.name}"\r\n'
    f"Content-Type: application/json\r\n\r\n"
).encode('utf-8') + file_content + (
    f"\r\n--{boundary}\r\n"
    f'Content-Disposition: form-data; name="target"\r\n\r\n'
    f"{target_peer}\r\n"
    f"--{boundary}--\r\n"
).encode('utf-8')

req = urllib.request.Request(url, data=body)
req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')

try:
    with urllib.request.urlopen(req) as response:
        if response.status == 200:
            print("Successfully sent!")
            print("Response:", json.loads(response.read().decode()))
        else:
            print("Failed.")
except urllib.error.URLError as e:
    print(f"Error: {e}")

# 4. Cleanup
if data_file.exists():
    data_file.unlink()
