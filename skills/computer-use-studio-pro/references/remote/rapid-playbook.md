# Rapid Remote Troubleshooting Playbook

Read only the section matching the active hypothesis.

## Contents

- Remote input and focus
- Network and proxy
- Plugin or package installation
- App startup, crash, or freeze
- Permissions and protected actions
- Finish criteria

## Remote input and focus

1. Confirm the remote-control session latency/connection indicator is healthy.
2. Check whether a local overlay, toolbar, on-screen keyboard, notification, or child window covers the remote target.
3. Click one reversible remote control and verify a visible state change.
4. If clicks work but typing does not, inspect shared-clipboard/keyboard forwarding. Test with one harmless visible character.
5. If the remote client window ID changed, reacquire it before the next action.

Pivot rule: after two failed input methods, have the user type the exact short value; continue all observation and clicking work immediately afterward.

## Network and proxy

Use a split test:

1. Does a general HTTPS page load on the remote computer?
2. Does the exact service domain load?
3. Does the desktop app use the same proxy path as the browser?

Check, in order:

- remote connection itself;
- system clock and timezone;
- DNS/general HTTPS;
- proxy application running state;
- system proxy versus TUN mode;
- selected node and rule/global mode;
- firewall/antivirus prompt;
- service/CDN domains required by the failing app.

Changing a node, proxy mode, VPN/TUN, firewall, or security setting is consequential. Capture the original state and follow action-time confirmation requirements.

## Plugin or package installation

Separate four independent layers:

1. **Catalog visibility:** the marketplace loads and the item is listed.
2. **Entitlement/auth:** the desktop app account/provider supports the item. API/custom-provider mode can differ from ChatGPT/OAuth mode; browser login is separate.
3. **Bundle download:** the app can reach GitHub, release assets, CDN/object storage, and the marketplace backend.
4. **Local activation:** the app can write to its plugin directory and load the manifest/dependencies.

Fast checks:

- Record the exact error/toast and whether it appears immediately or after download progress.
- Immediate failure usually favors entitlement, auth, policy, or manifest validation; delayed failure favors network, CDN, disk, or extraction.
- Compare the marketplace offered for the current login mode with the plugin's declared marketplace.
- Verify app version and workspace plugin permissions.
- Retry once only after changing the suspected cause, then restart/refresh the app once.
- Read logs on the remote machine only. Do not substitute similarly named local logs.

Success is not “the button was clicked.” Require `Installed`, an enabled toggle, the plugin in the installed list, or a successful minimal invocation.

## App startup, crash, or freeze

1. Wait briefly for a visible busy state; avoid duplicate launches.
2. Check for a hidden modal or child dialog.
3. Preserve unsaved work when visible.
4. Restart the affected app once.
5. If unchanged, check free space, update state, conflicting processes, and security prompts before another restart.

## Permissions and protected actions

- Distinguish remote app permissions from ToDesk/Sunlogin permissions.
- Check UAC, controlled-folder access, antivirus quarantine, firewall prompts, workspace admin policy, and read-only directories.
- Stop for user takeover at credentials, OTP/passkey, CAPTCHA, account recovery, or elevation prompts requiring user judgment.
- Do not weaken security controls as a diagnostic shortcut. Use the narrowest temporary change and restore it after testing.

## Finish criteria

Before reporting success, capture one fresh remote view and verify the requested outcome directly. Include only evidence from the remote computer.
