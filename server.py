#!/usr/bin/env python3
"""
Gordon Ramsay — local file server
Serves the app and stores each recipe as a JSON file in ./recipes/
Run: python3 server.py
Then open: http://localhost:8080
"""

import http.server
import json
import os
import re
import urllib.request
import urllib.error
from pathlib import Path

PORT = 8080
RECIPES_DIR = Path(__file__).parent / "recipes"
RECIPES_DIR.mkdir(exist_ok=True)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


class Handler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {args[0]} {args[1]}")

    # ── routing ──────────────────────────────────────────────────────────────

    def do_GET(self):
        if self.path == "/api/recipes":
            self._get_recipes()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/recipes":
            self._save_recipe()
        elif self.path == "/api/parse-image":
            self._parse_image()
        else:
            self._not_found()

    def do_DELETE(self):
        m = re.fullmatch(r"/api/recipes/([a-zA-Z0-9_-]+)", self.path)
        if m:
            self._delete_recipe(m.group(1))
        else:
            self._not_found()

    def do_OPTIONS(self):
        self._send_cors()

    # ── handlers ─────────────────────────────────────────────────────────────

    def _get_recipes(self):
        recipes = []
        for f in sorted(RECIPES_DIR.glob("*.json")):
            try:
                recipes.append(json.loads(f.read_text()))
            except Exception:
                pass
        self._json(recipes)

    def _save_recipe(self):
        body = self._read_body()
        try:
            recipe = json.loads(body)
            rid = recipe.get("id", "")
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", rid):
                raise ValueError("invalid id")
        except Exception as e:
            self._error(400, str(e))
            return
        path = RECIPES_DIR / f"{rid}.json"
        path.write_text(json.dumps(recipe, indent=2))
        self._json(recipe, 201)

    def _delete_recipe(self, rid):
        path = RECIPES_DIR / f"{rid}.json"
        if path.exists():
            path.unlink()
            self._json({"ok": True})
        else:
            self._error(404, "not found")

    def _parse_image(self):
        if not ANTHROPIC_API_KEY or ANTHROPIC_API_KEY == "paste-your-key-here":
            self._error(400, "No API key set. Add your Anthropic API key to the .env file.")
            return

        body = self._read_body()
        try:
            payload = json.loads(body)
            image_b64 = payload["image"]
            media_type = payload.get("mediaType", "image/jpeg")
        except Exception:
            self._error(400, "Invalid request body")
            return

        prompt = """Extract the recipe from this image and return ONLY a valid JSON object with this exact structure:
{
  "name": "Recipe Name",
  "serves": 4,
  "ingredients": [
    { "name": "Ingredient", "amount": 100, "unit": "g" }
  ],
  "steps": [
    "Step one description",
    "Step two description"
  ]
}

Rules:
- serves must be a number (default to 4 if not shown)
- amount must be a number (default to 1 if unclear)
- unit must be one of exactly: g, kg, ml, dl, l, tsp, tbsp, cup, pcs, pinch, slices, bunch — or empty string if none. Always normalise to these English abbreviations regardless of the language in the image (e.g. spsk → tbsp, stk → pcs, knivspids → pinch, spsk → tbsp, dl is already canonical)
- steps should be plain text sentences
- Return ONLY the JSON, no markdown, no explanation"""

        request_body = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1024,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }
            ],
        }).encode()

        req = urllib.request.Request(
            ANTHROPIC_API_URL,
            data=request_body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read())
            text = result["content"][0]["text"].strip()
            # Strip markdown code fences if present
            if text.startswith("```"):
                text = re.sub(r"^```[a-z]*\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            recipe = json.loads(text)
            self._json(recipe)
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"  Anthropic API error: {err}")
            self._error(502, "Claude API error — check your API key and credits.")
        except Exception as e:
            print(f"  Parse error: {e}")
            self._error(500, f"Failed to parse recipe: {e}")

    # ── helpers ───────────────────────────────────────────────────────────────

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length).decode()

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self._send_cors(status, "application/json", len(body))
        self.wfile.write(body)

    def _error(self, status, msg):
        self._json({"error": msg}, status)

    def _not_found(self):
        self._error(404, "not found")

    def _send_cors(self, status=204, content_type=None, length=0):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if content_type:
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
        self.end_headers()


if __name__ == "__main__":
    os.chdir(Path(__file__).parent)
    print(f"Gordon Ramsay running at http://localhost:{PORT}")
    print(f"Recipes stored in: {RECIPES_DIR.resolve()}")
    if not ANTHROPIC_API_KEY or ANTHROPIC_API_KEY == "paste-your-key-here":
        print("  ⚠  No API key found — image parsing disabled. Add key to .env file.")
    else:
        print("  ✓  Anthropic API key loaded — image parsing enabled.")
    print("Press Ctrl+C to stop.\n")
    http.server.HTTPServer(("", PORT), Handler).serve_forever()
