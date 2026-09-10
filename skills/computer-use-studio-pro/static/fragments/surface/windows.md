# Windows Surface

- Select one returned application window from the host tool; never construct a handle or reuse a stale window, element, screenshot, or coordinate.
- A newly discovered window is a candidate, not proof that it is ready. Activate/rebind it and wait for a task-specific ready state before the first input. A blind delay alone is not readiness evidence.
- For text input, use a focused control or direct value. Submitted terminal batches use the verified clipboard bridge; ordinary GUI fields use the lowest-call verified transport. Verify focus and result.
- Prefer UI Automation/accessibility information over full screenshots. Use screenshots only for weak semantics, and use window-relative coordinates from the current capture when visual interaction is necessary.
- For software acquisition, check installed state first, then use the verified Microsoft Store publisher listing when present; next use the publisher's domestic official page, global official page, and finally publisher-maintained GitHub Releases. An explicit or success-required download starts directly, while installer/elevation handling remains at its action-time boundary.
- Rebind after display, DPI, zoom, window, remote-session, or monitor changes. Do not carry coordinates across observations or assume a single-monitor origin.
- After a failed action, classify focus, loading, modal, recognition, permission, network, transport, or unknown; refresh and change strategy rather than replaying blindly.
- Keep secure desktop, lock screen, UAC/security/privacy, authentication, password-manager, and antivirus boundaries with the user. For ordinary remote command work, prefer a structured executor, then the verified visible-client terminal bridge. Reserve the Run dialog for a GUI launch fallback, not command batches.
- For desktop software, pair fast structured/terminal setup with one real GUI acceptance flow; package or path detection alone is `presence`, not user-flow completion.
