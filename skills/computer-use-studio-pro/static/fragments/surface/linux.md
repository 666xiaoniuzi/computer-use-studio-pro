# Linux Surface

- Prefer AT-SPI roles, names, states, and relationships. Expect toolkit and desktop-environment differences across GTK, Qt, Electron, GNOME, KDE, X11, and Wayland.
- Keep the app/window binding alive but remap after workspace, compositor, scale, theme, window, or modal changes.
- Use direct value-setting and known native shortcuts only with a verified postcondition.
- Treat portal, polkit, keyring, login, screen-lock, and permission prompts as user boundaries.
- Under Wayland or a restricted remote session, input injection or capture may be unavailable. Stop or switch to an approved portal/controller instead of bypassing restrictions.
- If AT-SPI is missing or incomplete, use a cropped visual route and load the visual-only fragment too.
