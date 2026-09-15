# Releasing

Releases are approved by an existing `v*` Git tag. Merging to `main` never publishes a package.

## One-time configuration

The npm package `dsh-failure-capsule` must trust this GitHub Actions publisher:

- Organization or user: `YiHarvest`
- Repository: `dsh-failure-capsule`
- Workflow filename: `release.yml`
- Environment: `release`

The repository's GitHub `release` environment must allow only tags matching `v*`. npm publishing uses OIDC and stores no long-lived npm token. GitHub Packages uses the job-scoped `GITHUB_TOKEN`.

## Publish a version

1. Update `package.json`, `package-lock.json`, the embedded capsule version, and `CHANGELOG.md` in a pull request.
2. Merge the pull request and wait for `main` CI to pass.
3. Tag the exact merge commit and push the tag:

   ```bash
   git fetch origin main --tags
   git tag v0.2.4 origin/main
   git push origin v0.2.4
   ```

The workflow validates that the tag belongs to `main` and matches `package.json`, runs the full check suite, creates one tarball and checksum, publishes that tarball to npm and GitHub Packages, then creates the GitHub Release.

## Resume a failed release

Jobs are idempotent: an existing registry version is accepted only when its integrity matches the verified tarball, and an existing GitHub Release receives any missing assets. Prefer GitHub's **Re-run failed jobs** action.

To dispatch manually, run the workflow from the same release tag and pass that tag as the input:

```bash
gh workflow run release.yml --ref v0.2.4 -f tag=v0.2.4
```

Do not dispatch from `main`; source-ref validation and the `release` environment policy intentionally reject it.
