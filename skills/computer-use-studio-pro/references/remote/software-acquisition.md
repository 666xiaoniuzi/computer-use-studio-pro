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

Return only secret presence or fingerprints. When configuration is part of the task, collect every effective override layer in this same pass, then apply one backed-up idempotent batch, reload/restart once, and run one real end-to-end check.

On Windows, enumerate all launcher candidates and choose `.exe`/`.com`/`.cmd`/`.bat` before `.ps1`; this keeps npm and similar tools independent of the current PowerShell script policy. Use collision-resistant `__Cusp_*` names for batch helpers and preflight them with `Get-Command`. Mark an absent command/package as `environment_gap`, then repair it; use `workflow_failure` only when the selected execution path actually fails.

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

Success means the requested application launches and passes the task's minimal functional test; download completion alone is intermediate evidence.
