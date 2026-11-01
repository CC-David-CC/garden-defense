# Controls — Garden Defense

All columns produce the same game intents. These mappings are design targets, not tested input bindings.

| Command | Desktop | Phone | Headset |
|---|---|---|---|
| `build` | Click tower then legal site | Tap tower then legal site | Flat browser-window controls |
| `upgrade` | Select tower and choose upgrade | Bottom-sheet upgrade buttons | Flat browser-window controls |
| `start-wave` | Start wave button | Start wave button | Flat browser-window controls |
| `speed` | 1×/2× buttons | 1×/2× buttons | Flat browser-window controls |
| `pause-resume` | Escape / Pause or Resume button | Visible Pause / Resume | Flat browser-window controls |
| `settings` | Settings panel | Scrollable settings sheet | Flat browser-window controls |
| `load-save` | Load / Save document actions | Load / Save actions | Flat browser-window controls |
| `restart` | Restart after confirmation | Restart after confirmation | Flat browser-window controls |

## Input arbitration

A UI gesture is consumed once. Menu/Rive controls do not also fire into the game underneath. Pointer ids own their gestures; cancel/up/blur clears held state. Do not capture arrows/Space while another app or text field is focused. A touchscreen needs no hover or right-click. Keyboard menus retain visible focus.

Responsive layout follows this window's size; phone portrait and landscape must both remain playable, with contextual controls outside the important play area. Hardware gamepads are optional. The headset's native target-ray/select path is the baseline for immersive controls; articulated hands are an enhancement where this app specifies them.

See [phone/input guidance](../../docs/PHONE-AND-INPUT.md) and [common gates](../../docs/ACCEPTANCE-COMMON.md).
