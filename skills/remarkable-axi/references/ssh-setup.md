# One-time device SSH setup

Everything here is manual and on-device — `remarkable-axi` doesn't have an
SSH-config command yet. Do this once per tablet; it's what
[ink-recovery.md](ink-recovery.md) assumes is already working.

## 1. Enable SSH on the device

On the tablet: **Settings → Help → About**. The About screen shows a
password and, on recent firmware, a toggle for SSH over WLAN — enable it if
it isn't already on. SSH only listens on the device's WLAN address, so this
is also why [the recovery playbook](ink-recovery.md#the-hands-off-discipline--read-before-you-touch-anything)
insists Wi-Fi stays on: it's the only path SSH has in.

## 2. Read the password

The same About screen shows the current root password in plain text. It's
device-specific and rotates — see the warning below.

## 3. Install a key

From a machine that can already reach the tablet's IP (same Wi-Fi network),
copy your public key up so future connections don't need the password:

```sh
ssh-copy-id root@<device-ip>
```

Enter the About-screen password once when prompted. After this, `ssh
root@<device-ip>` should connect with no password at all. If your machine
doesn't have `ssh-copy-id`, appending your public key to
`/home/root/.ssh/authorized_keys` on the device by hand does the same thing.

Add an alias to `~/.ssh/config` so the rest of this skill's examples (and
your own shell history) don't have to repeat the raw IP:

```
Host remarkable
  HostName <device-ip>
  User root
```

## 4. The password rotates — this matters

**The factory/About-screen password changes every time "SSH over WLAN" is
toggled off and back on.** If SSH suddenly stops accepting your key, check
whether the toggle got flipped (a firmware update can reset it) — read the
About screen again for the current password and redo step 3. This also means
the password isn't a durable secret: if one leaks, toggling the setting off
and on invalidates it.

## 5. Direct destination vs. relayed access

Whether you can reach the tablet's address directly depends on where you're
running commands from:

- **Same network as the tablet** (a laptop on the same Wi-Fi) — connect
  directly: `ssh root@<device-ip>` or the `~/.ssh/config` alias from step 3.
- **A different network** (a remote devbox, a machine that can't see the
  tablet's LAN) — relay through a machine that *can* reach it, using SSH's
  own `ProxyJump`:

  ```sh
  ssh -J <jump-host> root@<device-ip>
  ```

  or in `~/.ssh/config`:

  ```
  Host remarkable
    HostName <device-ip>
    User root
    ProxyJump <jump-host>
  ```

Either way, once the alias resolves and connects with no password prompt,
you're ready for the recovery procedure — substitute your real
`ssh <destination>` (or the `remarkable` alias) everywhere
[ink-recovery.md](ink-recovery.md) shows a placeholder.

**Note the device's LAN address is not stable** — DHCP tends to reassign it,
so re-check the About screen or your router if a previously working
connection stops resolving.
