# SightKick on Harbor

The browser version of SightKick plus its stem server, built from this repository on your Harbor machine.

- **web**: the app, served by nginx. It forwards `/stem-api/` to the stem server, so the app splits songs on this machine out of the box.
- **stem-server**: splits a song into drums, bass, vocals and the rest (HTDemucs, or BS-RoFormer with the *Best* preset), and drums into kick, snare, toms, hi-hat, ride and crash. It runs on the CPU.

**Use HTTPS.** The song library and Web MIDI only work on a secure address: open SightKick through Harbor's secure LAN address, Tailscale or a domain, in Chrome or Edge.

**Splits are cached for good.** Every finished split is stored in the *split cache* storage, keyed by the song's audio. Asking for the same song again, from any browser, returns the stems at once. The cache only grows (about 20 to 50 MB per song); pick a folder with room for it at install.

**First split.** The splitting model (about 80 MB) downloads when the app first starts; the Best and drum-kit models download the first time you use them. A 5-minute song takes a minute or two with the Fast preset on a modern CPU, several times longer with Best.

**No login of its own.** Anyone who can open SightKick can queue splits, which use the whole CPU. Turn on Harbor's app login before publishing it on the internet.

The first install builds both images from source, which takes several minutes.
