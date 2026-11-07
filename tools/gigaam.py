#!/usr/bin/env python3
import argparse
import io
import json
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import sherpa_onnx

MAX_BODY = 10 << 20


def transcribe(recognizer, body: bytes) -> str:
    with wave.open(io.BytesIO(body), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError("expected mono 16-bit PCM WAV")
        if source.getframerate() != 16000:
            raise ValueError("expected 16 kHz audio")
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype=np.int16)
    audio = samples.astype(np.float32) / 32768.0
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, audio)
    recognizer.decode_stream(stream)
    return stream.result.text.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--tokens", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8177)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()

    started = time.time()
    recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
        model=args.model,
        tokens=args.tokens,
        num_threads=args.threads,
        feature_dim=64,
    )
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def send(self, status: int, body: bytes, kind: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path != "/health":
                self.send(404, b"not found", "text/plain")
                return
            self.send(200, b"ok", "text/plain")

        def do_POST(self) -> None:
            if self.path != "/inference":
                self.send(404, b"not found", "text/plain")
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                self.send(413, b"audio is empty or too large", "text/plain")
                return
            body = self.rfile.read(length)
            began = time.time()
            try:
                with lock:
                    text = transcribe(recognizer, body)
            except Exception as error:  # noqa: BLE001
                self.send(400, str(error).encode(), "text/plain")
                return
            elapsed = time.time() - began
            print(
                f"gigaam: {len(body)} bytes in {elapsed:.2f}s -> {len(text)} chars",
                flush=True,
            )
            self.send(200, json.dumps({"text": text}).encode(), "application/json")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"gigaam: listening on http://{args.host}:{args.port} "
        f"(model loaded in {time.time() - started:.1f}s)",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
