# Prontera Walk (Ragnarok MVP)

Top-down exploration prototype: a **96×96** slice of **Prontera** uses walkability from a real `.gat` file, and character sprites load from a **ragassets**-compatible HTTP API (default: public demo host).

## Run locally

```bash
cd ragnarok-mvp
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/` (needs network for map + sprites).

## Point at your own ragassets gateway

Edit `data/game.json` → `assetBase` (e.g. `http://localhost:8080` after you build and run the gateway from the [ragassets](https://github.com/adsonpleal/ragassets) repo with extracted `resources/`).

## Controls

- **WASD / stick** — move  
- **Shift / Space / DASH** — sprint  
- **E / USE** — talk when near an NPC  

## Next steps (ideas)

- Full map size or map switcher (`/maps/index.json`)  
- GND texture rendering instead of placeholder tiles  
- Combat, jobs, inventory, warp gates  

---

Built with [BrainDaemon](https://braindaemon.com)
