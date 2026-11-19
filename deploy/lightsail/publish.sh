#!/usr/bin/env bash
set -euo pipefail
# Called only from a successful main CI run, not a PR.
: "$GITHUB_SHA" "$GITHUB_REPOSITORY" "$GH_TOKEN"
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
tag="api-$GITHUB_SHA"
api="repos/$GITHUB_REPOSITORY"
is_current() {
  [[ "$(gh api "$api/git/ref/heads/main" --jq .object.sha)" == "$GITHUB_SHA" ]]
}
if ! is_current; then
  echo "Main advanced; the newer CI run owns publication."
  exit 0
fi
# Compare against the last published API, not just the previous push. This
# also catches backend changes from a failed or cancelled earlier CI run.
latest=$(gh api "$api/releases?per_page=100" --paginate --slurp \
  | jq -r '[.[][] | select(.draft == false and .prerelease == false and (.tag_name | test("^api-[0-9a-f]{40}$")))] | first | .tag_name // ""')
if [[ -n "$latest" ]] && git cat-file -e "$latest^{commit}"; then
  if git diff --quiet "$latest" "$GITHUB_SHA" -- apps/api; then
    echo "No API changes since published release $latest."
    exit 0
  fi
fi
# A rerun may encounter its own incomplete draft; never replace a published asset.
existing=$(gh api "$api/releases?per_page=100" --paginate --slurp \
  | jq -r "[.[][] | select(.tag_name == \"$tag\")] | first | if . == null then \"absent\" elif .draft then \"draft\" else \"published\" end")
if [[ "$existing" == published ]]; then
  echo "Release already published."
  exit 0
fi
fingerprint=$(git ls-tree -r "$GITHUB_SHA" -- apps/api/internal/database/migrations apps/api/internal/database/migrate.go apps/api/start.sh apps/api/go.mod apps/api/go.sum | sha256sum | cut -d' ' -f1)
image="todocal-api:$GITHUB_SHA"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
archive="$work/todocal-api-$fingerprint.tar.gz"
docker build --platform linux/amd64 \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  --label "io.todocal.migrations=$fingerprint" \
  --build-arg "GIT_COMMIT=$GITHUB_SHA" \
  -t "$image" apps/api
docker save "$image" | gzip -1 > "$archive"
[[ $(stat -c %s "$archive") -lt 2147483648 ]]
if ! is_current; then
  echo "Main advanced during build; discard unpublished image."
  exit 0
fi
if [[ "$existing" == draft ]]; then
  # This only removes an unpublished draft, with a matching commit-specific tag.
  gh release delete "$tag" --yes
fi
gh release create "$tag" "$archive" --target "$GITHUB_SHA" --draft \
  --title "TodoCal API $GITHUB_SHA" --notes "Built after successful main CI. Linux amd64."
# Do not make a partially uploaded draft visible to the deployment poller.
asset=$(gh api "$api/releases?per_page=100" --paginate --slurp \
  | jq -r "[.[][] | select(.tag_name == \"$tag\" and .draft) | .assets[] | select(.name == \"$(basename "$archive")\" and .state == \"uploaded\")] | first | .digest // \"\"")
[[ "$asset" == "sha256:$(sha256sum "$archive" | cut -d' ' -f1)" ]]
if ! is_current; then
  echo "Main advanced; leaving release as an unpublished draft."
  exit 0
fi
gh release edit "$tag" --draft=false --latest
