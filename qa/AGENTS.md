# GDT isolated QA rules

These scripts bootstrap two disposable Game Dev Tycoon smoke profiles; they are not a player installer. Follow [qa/README.md](./README.md) and the [bridge contract](../BRIDGE-CONTRACT.md) for staging and acceptance.

- Use only each tester's licensed local game copy. Keep `game/`, `saves/`, and `chromium/` isolated per profile; never point QA at the ordinary installation or personal save directory.
- Install the early storage hook only in staged HTML after verifying the exact supported source. If the native save sentinel, directory boundary, or hook fails, fail closed before game code loads. Do not weaken Steam initialization or ownership checks.
- The Hub-generated configuration carries a launch-scoped credential and stays outside Git and player packages. Do not log, paste into fixtures, or embed it in `dist/` or these QA scripts.
- Static `npm run verify:source` is safe for this repo, but two-client save/reconnect, item delivery, and live Hub acceptance remain separate release gates. Do not run a bot installer or publish a player payload based on these scripts alone.
