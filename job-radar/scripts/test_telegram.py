#!/usr/bin/env python3
"""Envia un mensaje de prueba por Telegram para verificar TELEGRAM_BOT_TOKEN
y TELEGRAM_CHAT_ID. Sin dependencias externas (solo stdlib) para poder
correr antes de tener el resto del proyecto armado.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

MESSAGE = "Job Radar funcionando ✅"


def main() -> int:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print(
            "Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID en el entorno.",
            file=sys.stderr,
        )
        return 1

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": MESSAGE}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"Telegram respondio {exc.code}: {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"No se pudo conectar a Telegram: {exc.reason}", file=sys.stderr)
        return 1

    result = json.loads(body)
    if not result.get("ok"):
        print(f"Telegram devolvio un error: {result}", file=sys.stderr)
        return 1

    print("Mensaje de prueba enviado correctamente.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
