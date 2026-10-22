#!/usr/bin/env python3
"""
Builds src/data/champions.json for the browser trainer.

Sources (both public, no auth required):
  * Meraki Analytics  - champion base stats (incl. attackCastTime windup, attack
                        speed, ranges), spell cast time, projectile speed,
                        targeting type and spell-effect shape.
  * CommunityDragon   - authoritative numeric spell ranges and champion roles.

The field layout mirrors the Skill Gap `ChampionSO` schema that was recovered
from the installed client (health / visionRange / speed / armor /
magicResistance / attackDamage / attackRange / projectileSpeed / attackSpeed /
windUpPercentage / isMelee / abilityPower / abilityHaste), so the browser
trainer reads the same concepts the desktop client used.

Usage:
    python tools/build-champions.py [--meraki <path-to-meraki-champions.json>]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src", "data", "champions.json")

MERAKI_URL = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json"
CD_SUMMARY_URL = (
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/"
    "global/default/v1/champion-summary.json"
)
CD_CHAMPION_URL = (
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/"
    "global/default/v1/champions/{id}.json"
)

# Roster: 12 marksmen for the kiting drills, 12 skillshot casters for the
# dodging drills. Keys are Meraki/CD alias names.
MARKSMEN = [
    "Ezreal", "Caitlyn", "Ashe", "Jinx", "Kaisa", "Lucian",
    "MissFortune", "Tristana", "Vayne", "Varus", "Xayah", "Aphelios",
]
CASTERS = [
    "Ahri", "Morgana", "Lux", "Brand", "Thresh", "Nautilus",
    "Blitzcrank", "Ekko", "Annie", "Zed", "Syndra", "Velkoz",
]
ROSTER = MARKSMEN + CASTERS

# Display names that differ from the data alias.
DISPLAY_NAME = {
    "Kaisa": "Kai'Sa",
    "MissFortune": "Miss Fortune",
    "Velkoz": "Vel'Koz",
}

SLOTS = ["P", "Q", "W", "E", "R"]


def first_number(value):
    """Pull the leading numeric value out of strings like '1550 / 60 - 2600'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(match.group(0)) if match else None


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "skillgap-web-builder/1.0"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def meraki_range(ability: dict):
    """Meraki keeps the numeric spell range inside effects[].leveling[]."""
    for effect in ability.get("effects") or []:
        for entry in effect.get("leveling") or []:
            attribute = (entry.get("attribute") or "").lower()
            if attribute in ("range", "cast range", "effect range", "target range"):
                for modifier in entry.get("modifiers") or []:
                    values = modifier.get("values") or []
                    if values:
                        return float(values[0])
    return None


def classify(ability: dict):
    """Map Meraki's targeting vocabulary onto a shape we render.

    Meraki marks a spell `spellEffects: "Area of effect"` when the *hit area*
    of a travelling missile is an area, not when the ability is a ground
    circle. The reliable discriminator is therefore `targeting`:
      Direction      -> a linear skillshot travelling away from the caster
      Location       -> a circle detonating at a ground point
      Self / Unit    -> a self-cast, never used as a dodge threat
    """
    targeting = (ability.get("targeting") or "").lower()
    effects = (ability.get("spellEffects") or "").lower()
    projectile = bool(ability.get("projectile"))

    if "cone" in effects:
        shape = "cone"
    elif "direction" in targeting:
        shape = "linear"
    elif "location" in targeting:
        shape = "circle"
    else:
        shape = "self"

    speed = first_number(ability.get("speed"))
    if shape == "linear" and not projectile:
        # Non-projectile directional casts (Lux R, Annie W) still sweep an area.
        speed = None
    return shape, speed


# Curated geometry for the skillshots the drills actually spawn.
#   width  = HALF width of a linear skillshot, in game units
#   radius = radius of a ground circle, in game units
#   length = reach of a cone, in game units
# Riot publishes the full missile width; the hit test below needs the half.
SKILLSHOT_GEOMETRY = {
    "Ahri|Q": {"width": 100, "length": 970},
    "Ahri|E": {"width": 100, "length": 975},
    "Lux|Q": {"width": 60, "length": 1300},
    "Lux|E": {"radius": 200, "length": 1100},
    "Lux|R": {"width": 100, "length": 3340},
    "Thresh|Q": {"width": 70, "length": 1100},
    "Blitzcrank|Q": {"width": 70, "length": 1150},
    "Brand|Q": {"width": 95, "length": 1050},
    "Brand|W": {"radius": 225, "length": 900},
    "Brand|E": {"radius": 240, "length": 625},
    "Morgana|Q": {"width": 70, "length": 1300},
    "Morgana|W": {"radius": 275, "length": 800},
    "Nautilus|Q": {"width": 90, "length": 1122},
    "Caitlyn|Q": {"width": 50, "length": 1250},
    "Caitlyn|E": {"width": 50, "length": 950},
    "Zed|Q": {"width": 50, "length": 700},
    "Ekko|Q": {"width": 75, "length": 1150},
    "Ekko|W": {"radius": 200, "length": 700},
    "Velkoz|Q": {"width": 75, "length": 1150},
    "Velkoz|E": {"radius": 175, "length": 825},
    "Syndra|Q": {"radius": 200, "length": 925},
    "Syndra|E": {"width": 70, "length": 675},
    "Ezreal|Q": {"width": 60, "length": 1150},
    "Ezreal|W": {"width": 70, "length": 475},
    "Ezreal|R": {"width": 100, "length": 25000},
    "Ashe|W": {"width": 50, "length": 1200},
    "Jinx|W": {"width": 50, "length": 925},
    "Kaisa|W": {"width": 60, "length": 1300},
    "Annie|Q": {"width": 60, "length": 600},
    "Annie|W": {"length": 625},
    "Annie|R": {"radius": 250, "length": 600},
    "Varus|Q": {"width": 50, "length": 1625},
    "MissFortune|R": {"width": 130, "length": 1400},
    "Lucian|W": {"width": 60, "length": 900},
    "Tristana|R": {"width": 60, "length": 700},
    "Xayah|Q": {"width": 45, "length": 1000},
    "Vayne|E": {"width": 50, "length": 475},
}

# Cone-shaped casts that Meraki reports as a directional AoE.
CONE_SPELLS = {
    "Annie|W": 325,
    "Cassiopeia|R": 825,
    "Syndra|R": 800,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--meraki", help="path to a pre-downloaded meraki champions.json")
    parser.add_argument("--offline", action="store_true", help="only use cached files")
    args = parser.parse_args()

    cache = os.path.join(REPO, "tools", ".cache")
    os.makedirs(cache, exist_ok=True)

    meraki_path = args.meraki
    if not meraki_path:
        cached = os.path.join(cache, "meraki-champions.json")
        if args.offline and os.path.exists(cached):
            meraki_path = cached
        else:
            print("downloading meraki champions.json ...", flush=True)
            meraki_path = cached
            with urllib.request.urlopen(
                urllib.request.Request(MERAKI_URL, headers={"User-Agent": "skillgap-web-builder/1.0"}),
                timeout=180,
            ) as response:
                with open(meraki_path, "wb") as handle:
                    handle.write(response.read())

    print("loading meraki ...", flush=True)
    with open(meraki_path, encoding="utf-8") as handle:
        meraki = json.load(handle)

    print("downloading communitydragon summary ...", flush=True)
    cd_summary = fetch_json(CD_SUMMARY_URL)
    id_by_alias = {entry["alias"]: entry["id"] for entry in cd_summary if entry.get("id", -1) > 0}

    champions = []
    for name in ROSTER:
        if name not in meraki:
            print(f"  !! {name} missing from meraki", file=sys.stderr)
            continue
        source = meraki[name]
        champion_id = id_by_alias.get(name)
        cd = None
        if champion_id is not None:
            cd_path = os.path.join(cache, f"cd-{champion_id}.json")
            if os.path.exists(cd_path):
                with open(cd_path, encoding="utf-8") as handle:
                    cd = json.load(handle)
            else:
                try:
                    cd = fetch_json(CD_CHAMPION_URL.format(id=champion_id))
                    with open(cd_path, "w", encoding="utf-8") as handle:
                        json.dump(cd, handle)
                except Exception as exc:  # pragma: no cover - network hiccup
                    print(f"  !! communitydragon failed for {name}: {exc}", file=sys.stderr)

        stats = source["stats"]
        flat = lambda key: float(stats.get(key, {}).get("flat", 0) or 0)

        attack_range = flat("attackRange")
        attack_speed = flat("attackSpeed")
        attack_cast_time = flat("attackCastTime")
        attack_total_time = flat("attackTotalTime")
        # Attack period = time between two auto attacks.
        attack_period = attack_total_time if attack_total_time else (1.0 / attack_speed if attack_speed else 1.0)

        # Meraki `attackType` is "Melee"/"Ranged"/"Other".
        is_melee = (source.get("attackType") or "").lower() == "melee"

        spells = []
        for index, slot in enumerate(SLOTS):
            entries = source["abilities"].get(slot) or []
            if not entries:
                continue
            ability = entries[0]
            if not isinstance(ability, dict):
                continue

            shape, speed = classify(ability)
            mrange = meraki_range(ability)
            cd_range = None
            # CommunityDragon's `spells` array is [Q, W, E, R] - no passive.
            if cd and 0 < index < len(SLOTS):
                cd_index = index - 1
                if cd_index < len(cd.get("spells") or []):
                    raw = cd["spells"][cd_index].get("range")
                    if isinstance(raw, list) and raw:
                        cd_range = float(raw[0])
                    elif isinstance(raw, (int, float)):
                        cd_range = float(raw)

            final_range = cd_range or mrange
            cast_time = first_number(ability.get("castTime"))
            if cast_time is None:
                cast_time = 0.25

            key = "%s|%s" % (source["key"], slot)
            geometry = dict(SKILLSHOT_GEOMETRY.get(key, {}))
            if key in CONE_SPELLS:
                shape = "cone"
                geometry.setdefault("length", CONE_SPELLS[key])

            spell = {
                "slot": slot,
                "name": ability.get("name"),
                "shape": shape,
                "castTime": round(cast_time, 4),
                "speed": round(speed, 1) if speed else None,
                "range": round(final_range, 1) if final_range else None,
                "targeting": ability.get("targeting"),
                "projectile": bool(ability.get("projectile")),
                "damageType": ability.get("damageType"),
            }
            for field in ("width", "radius", "length"):
                if field in geometry:
                    spell[field] = geometry[field]
            if shape in ("linear", "cone") and "width" not in spell:
                spell["width"] = 120
            if shape == "circle" and "radius" not in spell:
                spell["radius"] = 200
            if shape in ("linear", "cone") and "length" not in spell:
                spell["length"] = spell["range"]
            spells.append(spell)

        # Auto-attack projectile speed: use the Q spell speed when the champion
        # has one, otherwise fall back to a sensible default.
        aa_speed = next(
            (s["speed"] for s in spells if s["slot"] == "Q" and s["speed"]), None
        )

        champion = {
            "id": champion_id,
            "name": DISPLAY_NAME.get(name, source["name"]),
            "alias": source["key"],
            "title": source["title"],
            "roles": [r.lower() for r in (source.get("roles") or [])],
            "icon": source.get("icon"),
            "stats": {
                "health": flat("health"),
                "healthRegen": flat("healthRegen"),
                "armor": flat("armor"),
                "magicResistance": flat("magicResistance"),
                "attackDamage": flat("attackDamage"),
                "attackRange": attack_range,
                "attackSpeed": attack_speed,
                "attackCastTime": attack_cast_time,
                "attackPeriod": round(attack_period, 4),
                "movementSpeed": flat("movespeed"),
                "visionRange": flat("acquisitionRadius"),
                "isMelee": is_melee,
                "projectileSpeed": aa_speed or 1400.0,
            },
            "spells": spells,
        }
        champions.append(champion)
        print(f"  + {name:<14} aa={attack_range:>5}  windup={attack_cast_time:.2f}  ms={flat('movespeed'):.0f}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump({"version": 1, "champions": champions}, handle, indent=1, ensure_ascii=False)
    print(f"\nwrote {OUT} ({len(champions)} champions)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
