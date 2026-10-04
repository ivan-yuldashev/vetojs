---
"@vetojs/core": patch
---

**`validatePayload` raises a missing include instead of answering without it.** When a rule's condition reaches a relation that was not loaded, the call now throws `RelationNotLoadedError` — the answer `can` and `canMutate` have always given. Until now a prohibition that matched earlier could settle the call first and the missing relation went unseen, so one policy and one row produced a throw from `canMutate` and a plain `{ ok: false }` from `validatePayload`: a refusal that reads as "the policy says no" where the truth was "there was not enough data to decide".

Load the relations a policy names before calling `validatePayload` on its own — the same ones `can` has always needed.

**A condition stops reading a relation a field already ruled out.** `{ status: "published", blog: { workspace: { id } } }` used to walk `blog` even for a draft, because a relation had to be read whatever the order of evaluation. That guarantee now stands before matching begins, so the walk happens once and the condition short-circuits like any other.
