# Generic adapter

Before acting, inventory the host's available interfaces: API/connector, filesystem, browser DOM, accessibility tree, screenshot/OCR, and coordinate input.

Choose the highest semantic interface that preserves the user's intended visible result. Translate the core loop to the host as: observe a current state, take one bounded action, obtain a fresh state, and test a declared postcondition.

Select execution/acceptance from known capabilities with zero probes: semantic routes for deterministic work, GUI for interaction, and hybrid for desktop products. Then use the shared single-pass inventory/mutation/reload/test/cleanup flow.

On Windows, execute the selected native/CMD absolute path rather than a bare name. Submitted commands use an IME-independent verified clipboard bridge; key fallback needs epoch-bound ASCII proof. Grade evidence from `presence` through `user_flow` and keep environment gaps distinct.

If the host cannot provide a required interface, do not invent it. Use an alternative supported route or request user assistance. Keep the host's own safety confirmations, rate limits, and permission rules.

Feed the already known tool names to `scripts/capability_router.py` once and cache the route map. Normal-path adaptation adds no probe action, screenshot, model turn, or network request. Reuse current action evidence for eligible completion checks and persist only verified milestones for restart recovery.
