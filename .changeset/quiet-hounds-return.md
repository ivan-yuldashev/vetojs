---
"@vetojs/core": patch
---

**`markLoaded` writes the relation name as a key on the copy.** A relation called `__proto__` replaced the copy's prototype instead of adding a key to it, so the value was invisible to `Object.keys` and `JSON.stringify` while every plain object read it through inheritance. The copy now carries the name as its own key and keeps the prototype it had.
