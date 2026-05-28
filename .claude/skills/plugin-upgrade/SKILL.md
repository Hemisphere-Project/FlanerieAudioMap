---
name: plugin-upgrade
description: >-
  Release and sync sibling Cordova plugin forks (cordova-plugin-audiofocus,
  cordova-plugin-power-optimization, cordova-background-geolocation-plugin,
  cordova-plugin-audio-simple) into FlanerieCordova. Bumps fork versions,
  commits/pushes the dirty repos, reinstalls plugins from the workspace forks,
  and runs `cordova prepare`. Use when a fork has uncommitted native changes,
  when a fork is ahead of its remote, when FlanerieCordova's plugin install is
  stale, or when bootstrapping a new fork into the workspace.
---

# Workspace plugin upgrade

Wraps `FlanerieCordova/scripts/sync-workspace-plugins.mjs`, the one source of
truth for releasing the four sibling forks into FlanerieCordova. The script
does dry-run by default and never mutates without `--apply`.

## Tracked forks

| Fork | Local path | npm spec in FlanerieCordova |
|---|---|---|
| `cordova-plugin-audiofocus` | `../cordova-plugin-audiofocus` | `github:Maigre/cordova-plugin-audiofocus` |
| `cordova-plugin-power-optimization` | `../cordova-plugin-power-optimization` | `github:Maigre/cordova-plugin-power-optimization` |
| `cordova-background-geolocation-plugin` | `../cordova-background-geolocation-plugin` | `github:Maigre/cordova-background-geolocation-plugin#stable` |
| `cordova-plugin-audio-simple` | `../cordova-plugin-audio-simple` | `github:Maigre/cordova-plugin-audio-simple` |

To add a fifth fork later, see [§ Adding a new fork](#adding-a-new-fork).

## What the script does in `--apply` mode

For each plugin (or the subset passed via `--plugins`):

1. **Inspect** the local repo: current branch, HEAD sha, `git status --porcelain`,
   `ahead/behind` of `origin/<branch>`, FlanerieCordova lockfile entry,
   installed-Cordova-plugin version.
2. **Release dirty forks**: if `git status` is dirty:
   - `package.json` version + `plugin.xml` `<plugin version>` are bumped (default
     `--bump patch`, accepts `minor` / `major`).
   - `git add -A` + `git commit -m "chore: release <name> v<next>"`.
   - `git push origin <branch>`.
3. **Push already-committed work**: forks that are `ahead > 0` get pushed even
   without a version bump.
4. **Refresh FlanerieCordova**:
   - `npm install --save-dev <name>@<dependencySpec>` for each affected fork
     (forces `package-lock.json` to pick up the new published HEAD).
   - Wipes `platforms/<android|ios>`.
   - `cordova plugin remove <name> --nosave` then
     `cordova plugin add <repoDir> --nosave [variables]` for each affected fork.
   - Re-adds the platforms.
   - `cordova prepare`.

## When to invoke

- Any time native code was edited in a fork (`*.java`, `*.m`, `plugin.xml`,
  `AndroidManifest.xml` config-file, `src/android/res/`).
- After committing fork work manually but before testing in FlanerieCordova.
- When `cordova plugin list` shows a stale version vs. the fork's
  `package.json`.
- When `npm run check:plugin-sources` fails on FlanerieCordova.
- When bootstrapping a brand-new fork into the workspace (see below).

## Workflow

Always cd into `FlanerieCordova/` first (the script anchors all paths off
`__dirname`):

```bash
cd /home/mgr/Bakery/Flanerie/FlanerieCordova
```

### Dry-run (always start here)

```bash
node scripts/sync-workspace-plugins.mjs
```

Reads each fork's git state + the app's `package-lock.json` and prints, per
plugin:
- `repo version` — current `package.json` version in the fork.
- `branch` — current branch (typically `main` or `stable`).
- `local head` / `published head` — the commit the fork is at vs. its
  `origin/<branch>`.
- `lockfile` — what FlanerieCordova's `package-lock.json` thinks is installed.
- `installed` — the version Cordova actually unpacked into `plugins/<name>/`.
- `status` line: `dirty/clean, push:N, behind:N, app-sync:yes/no`.
- `notes` — concrete reasons it'll act in `--apply` mode.

If every plugin reports `clean, push:0, behind:0, app-sync:no`, the script
prints "Everything is already clean and in sync" and exits.

### Apply

```bash
node scripts/sync-workspace-plugins.mjs --apply
```

Default bump is `patch`. Override with `--bump minor` or `--bump major` when
the fork shipped a breaking API change.

Restrict to a subset with `--plugins`:

```bash
node scripts/sync-workspace-plugins.mjs --apply \
  --plugins cordova-plugin-audiofocus,cordova-plugin-audio-simple
```

Skip the Cordova reinstall + `cordova prepare` step (useful when you just want
to release/push the forks without rebuilding the app):

```bash
node scripts/sync-workspace-plugins.mjs --apply --no-cordova
```

### Verify after apply

```bash
cordova plugin list                       # versions match fork package.json
npm run check:plugin-sources              # devDependencies entries intact
git -C ../cordova-plugin-<name> log -1    # release commit at origin
git status -s                             # FlanerieCordova lockfile updates
```

Commit the FlanerieCordova `package.json` + `package-lock.json` changes that
the script generated (the script does not auto-commit FlanerieCordova).

## Common situations

### Fork has dirty native changes, FlanerieCordova install is stale

The default path. Plain `--apply` handles it: bump + commit + push the fork,
then reinstall it in FlanerieCordova.

### Fork was committed manually (clean, but `push:N > 0`)

Script detects `ahead of origin by N`, skips version bump, pushes, then runs
the app refresh because the lockfile is now behind.

### Fork is behind origin

The script refuses to release (`<name> is behind origin/<branch>; pull/rebase
before releasing`). Fix in the fork repo:

```bash
cd ../cordova-plugin-<name>
git pull --rebase origin <branch>
```

Then re-run the script.

### Multiple forks dirty at once

Single `--apply` handles them all. Each gets its own release commit + push +
the app refresh batches all of them into one `npm install` + one platform
wipe + one `cordova prepare`.

### Just one fork, others should be untouched

```bash
node scripts/sync-workspace-plugins.mjs --apply \
  --plugins cordova-plugin-audiofocus
```

The script still inspects all four to print the report, but only acts on the
subset listed.

## Adding a new fork

When a brand-new sibling fork repo needs to be wired into the workspace
(example: `cordova-plugin-audio-simple` bootstrapped 2026-05-28 as `cordova-plugin-exoplayer-simple`, renamed in Round 24):

1. **Clone the empty repo** as a sibling of FlanerieCordova:
   `/home/mgr/Bakery/Flanerie/cordova-plugin-<name>/`. It needs an `origin`
   remote pointing at `github:Maigre/cordova-plugin-<name>`.

2. **Write the plugin code** (plugin.xml, package.json, src/, www/, etc.).
   Initial `version: "0.1.0"` is a fine convention; the script's first
   `--apply` bumps it to `0.1.1` on release (acceptable cosmetic quirk — the
   published HEAD is the first integration).

3. **Add to FlanerieCordova `package.json`** in both spots:
   - `devDependencies`: `"cordova-plugin-<name>": "github:Maigre/cordova-plugin-<name>"`
   - `cordova.plugins`: `"cordova-plugin-<name>": {}` (or with variables if needed)

4. **Add to `scripts/sync-workspace-plugins.mjs`** in the `pluginConfigs`
   array:
   ```js
   {
     name: 'cordova-plugin-<name>',
     repoDir: path.join(workspaceRoot, 'cordova-plugin-<name>')
   }
   ```

5. **Add to `scripts/validate-container.mjs`** in the `checkPluginSources`
   expected map so `npm run check:plugin-sources` covers it.

6. **Dry-run** to confirm the script sees the new fork:
   ```bash
   node scripts/sync-workspace-plugins.mjs --plugins cordova-plugin-<name>
   ```
   Expect: `dirty, push:0, behind:0, app-sync:yes` (because the lockfile has
   no entry for it yet).

7. **Apply**:
   ```bash
   node scripts/sync-workspace-plugins.mjs --apply --plugins cordova-plugin-<name>
   ```
   First release publishes the patch-bumped version, pushes to origin, then
   `npm install` writes the lockfile entry and `cordova prepare` builds.

8. **Update this skill's tracked-forks table** above so future invocations
   document the new entry.

## Notes

- The script anchors `appRoot = path.resolve(scriptDir, '..')`, so cwd must be
  FlanerieCordova (any cwd, but the script file path must resolve correctly —
  `cd FlanerieCordova` first).
- Plugin install variables (e.g.
  `cordova-background-geolocation-plugin.ALWAYS_USAGE_DESCRIPTION`) are read
  from FlanerieCordova's `package.json` `cordova.plugins` block and passed to
  `cordova plugin add` via `--variable KEY=VALUE`.
- The script wipes `platforms/<android|ios>` on every refresh. If you have
  uncommitted platform-side experiments, copy them out first.
- Forks NOT in the `pluginConfigs` list are untouched even with broad
  `--apply`.
- Native code in the FlanerieCordova `platforms/` tree is regenerated from
  the plugin sources on every `cordova prepare` — never edit it directly;
  edit the fork, then re-run this script.
