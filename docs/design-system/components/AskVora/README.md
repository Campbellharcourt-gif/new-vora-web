# AskVora

The public VORA AI panel, for when you switch it on (decision D8). It is an editorial transcript grounded in published pages, reached from the header — a way in, not a floating widget.

**The consumer provides:** the conversation, the sources for each answer (links to published pages), the input limit (`maxInputChars` from `ai.config`), and the user-facing error messages (`AI_USER_MESSAGES`).

**Rules**

- A 440 px right-hand sheet on desktop; full screen on mobile. It is a dialog (focus trap, `Esc`).
- Labels `YOU` / `VORA AI` instead of chat bubbles; no avatars, no sparkle icons, no gradient orb.
- Streaming text shows progressively; screen readers hear the finished answer. A Stop button shows while streaming.
- A permanent disclosure under the input, and a Talk to a person route to Contact.
- **Off today:** both the flag (`ai.public_assistant`) and the setting (`publicEnabled`) default to off.
