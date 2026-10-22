"""Downloads the champion portraits used by the trainer.

Source: CommunityDragon public champion square portraits.
The files land in assets/champions/<Alias>.png so the app works offline.
"""
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "champions")
CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "skillgap-web/1.0"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def main():
    os.makedirs(OUT, exist_ok=True)
    data = json.load(
        open(os.path.join(ROOT, "src", "data", "champions.json"), encoding="utf-8")
    )
    summary = json.loads(fetch(f"{CD}/champion-summary.json"))
    by_alias = {c["alias"]: c for c in summary if c.get("id", -1) > 0}

    for champion in data["champions"]:
        alias = champion["alias"]
        entry = by_alias.get(alias)
        if not entry:
            print(f"  !! sem resumo para {alias}")
            continue
        # CommunityDragon stores the square portraits next to the summary.
        url = f"{CD}/champion-icons/{entry['id']}.png"
        dest = os.path.join(OUT, f"{alias}.png")
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            continue
        try:
            with open(dest, "wb") as fh:
                fh.write(fetch(url))
            print(f"  + {alias}.png")
        except Exception as exc:
            print(f"  !! {alias}: {exc}")
    print(f"\nportraits em {OUT}")


if __name__ == "__main__":
    main()
