# Windows Surface

- Select one returned application window from the host tool; never construct a handle or reuse a stale window, element, screenshot, or coordinate.
- A newly discovered window is a candidate, not proof that it is ready. Activate/rebind it and wait for a task-specific ready state before the first input. A blind delay alone is not readiness evidence.
- For text input, use the host's focused editable control or direct-value operation when available. Verify focus and the resulting value. For ordinary clicks, keep the lighter readiness gate unless the application is known to lose focus.
- Prefer UI Automation/accessibility information over full screenshots. Use screenshots only for weak semantics, and use window-relative coordinates from the current capture when visual interaction is necessary.
- Rebind after display, DPI, zoom, window, remote-session, or monitor changes. Do not carry coordinates across observations or assume a single-monitor origin.
- After a failed action, classify the cause (focus, loading, modal, recognition, permission, network, or unknown), refresh state, and change strategy. Do not blindly replay an input.
- Stop for secure desktop, lock screen, UAC/security/privacy dialogs, authentication UI, password managers, and antivirus/security applications. Do not use this Skill to automate terminal commands or Windows Run dialogs through a GUI controller.
