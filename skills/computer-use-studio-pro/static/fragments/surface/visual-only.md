# Visual-Only Surface

- Use this route for canvas, remote desktop, streamed UI, game-like surfaces, image-only apps, and controls without usable semantic metadata.
- Capture the smallest region that contains the target and its state. Use original resolution for small text, crop before OCR, and confirm critical strings with a second signal.
- Derive the transform among image pixels, logical coordinates, physical pixels, window/viewport coordinates, zoom, and remote-session scale. Refresh it after any layout or geometry change.
- Bind the target to one window and display. Discover all displays only when necessary; handle negative display origins.
- Use the safe center of a hit region. For drag/resize, verify the start handle, make one controlled drag, then verify final geometry.
- Expect higher uncertainty: use one action per observation, shorter checkpoints, and more frequent postcondition checks.
- Do not infer unreadable text or reuse coordinates after animation, scrolling, zoom, window movement, or session resize.
