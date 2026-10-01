# DMS Game Dev Tycoon Archipelago Mod

Game Dev Tycoon mod artifacts and source for the DMS Archipelago integration.

## Links
- [Repo overview](../../../../../../README.md)
- [Discord bot](../../../README.md)
- [Archipelago integration root](../README.md)
- [Bot-side Archipelago logic](../bot/README.md)
- [Archipelago runtime](../../../../../game/archipelago/README.md)
- [APWorld source](../../../../../game/archipelago/APWorld/README.md)

## Install Flow
1. Download the installer `.bat` from the bot.
2. The installer locates the Steam and Game Dev Tycoon install plus the mod folder.
3. The installer downloads the latest mod assets from the bot and writes a small config file.

## Runtime Flow
- adds an Archipelago mode toggle for new games
- adds Archipelago settings in the main menu
- persists the toggle to the save and waits for company plus character name before syncing
- pulls item deliveries via the bot and syncs randomized data back to the bot
