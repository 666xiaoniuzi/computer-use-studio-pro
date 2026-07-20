# macOS Surface

- Prefer the Accessibility API by role, title, identifier, relationship, and state. Use screen coordinates only after a fresh window/display observation.
- Keep the application and window binding alive, but invalidate element references after navigation, sheet/modal changes, window moves, Spaces changes, zoom, or display reconfiguration.
- Use direct value-setting and native shortcuts when their result is observable. Verify focus before typing.
- Treat Accessibility, Screen Recording, Automation, Full Disk Access, biometric, keychain, and authentication prompts as permission boundaries for the user; do not change privacy/security settings.
- Account for Retina scaling, logical points versus pixels, multiple displays, negative origins, Spaces, sheets, and application-localized labels.
- If an application exposes weak accessibility, switch to cropped visual observation and use the visual-only fragment as well.
