# Remote Software Acquisition

Use this compact ladder whenever remote success involves checking, downloading, installing, updating, or configuring software.

## Feasibility first

Before opening a store or browser, map in one pass:

```text
remote OS/architecture | already installed/version | requested capability | actual product support
| required dependency | command/process environment | app + selector config precedence
| auth-store metadata | functional success test
```

Resolve product mismatches before spending download time. In particular, a coding-client switcher such as CC Switch configures the coding clients it supports; it does not change the model inside the official ChatGPT desktop application.

Return only secret presence or fingerprints. Call `selectTaskInteractionRoute` from declared capabilities: semantic execution for setup, GUI for interactive products, and hybrid for desktop software. Collect overrides in the same pass, apply one backed-up idempotent batch, reload/restart once, and run the required acceptance level.

On Windows, enumerate launchers and execute `buildWindowsCliInvocation(...).command`; this locks the selected native/CMD absolute path instead of re-resolving a bare name to `.ps1`. Use collision-resistant helpers with `Get-Command` preflight. Keep absent commands/packages as `environment_gap`, separate from an executed-path failure.

## Source order

1. Reuse a healthy installed copy when it satisfies the task.
2. On Windows, prefer Microsoft Store when the verified publisher package is present.
3. Prefer the publisher's domestic/regional official HTTPS download page when it serves the target region.
4. Otherwise use the publisher's global official download page.
5. Use GitHub Releases only when the repository is publisher-maintained or the official site identifies it as the release channel.
6. Skip mirrors, download aggregators, ads, repackaged installers, and look-alike domains.

Record publisher, product, version, architecture, source URL/channel, and signature/hash when exposed. Verify the publisher identity before launching the package.

## Prompt and execution rule

- If the user explicitly names software to download, or the accepted success condition clearly requires that dependency, start the verified download directly.
- Do not add a routine download or installation prompt merely because bytes will be saved or a verified installer will be launched.
- Treat the complete named-software flow—presence check, verified download, checksum/signature check when exposed, non-interactive installer launch, user-space installation, update, dependency bootstrap, and functional verification—as one continuous task action. Execute it through the available remote executor, terminal bridge, or computer-control route; do not present a PowerShell block for the user to copy and run.
- Prefer a non-elevated per-user install path. Keep action-time handling for system-wide elevation, private input, account sign-in, license/payment, and other host-required confirmation points.
- When the remote task exposes only a visible terminal, use the bound terminal-control path directly and verify the terminal result in the same runtime. Do not convert a routine terminal step into a customer handoff.
- Prefer one download path at a time. If it fails, record the exact failure, pivot once to the next verified source, and avoid duplicate installers.
- Launch the primary installer/terminal route once, wait for the expected window, and perform one last list check before a fallback route. Do not open a terminal and the Run dialog for the same launch race.
- Use a 20-minute soft decision budget for a routine fresh user-space installation. At the boundary, switch diagnostic strategy using the current failure signature instead of continuing the same interaction pattern.

## Windows quick route

```text
installed-app check -> Microsoft Store publisher result -> domestic official page
-> global official page -> publisher-maintained GitHub Releases
```

For ChatGPT on Windows, try the Microsoft Store publisher listing before browser downloads. For region-specific tools, use their domestic official site before GitHub unless that official site points to GitHub Releases.

Success uses the task's declared level: download/package/path is `presence`, opening is `launch`, a real operation is `functional`, and a normal desktop workflow is `user_flow`. Desktop requests receive one GUI acceptance check after the faster setup route.
