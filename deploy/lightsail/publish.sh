#!/usr/bin/env bash
set -euo pipefail
# Only the trusted main-CI completion workflow may publish tested images.
: "$TESTED_SHA" "$GITHUB_REPOSITORY" "$GH_TOKEN" "$GHCR_TOKEN" "$GITHUB_OUTPUT"
[[ "$(git rev-parse HEAD)" == "$TESTED_SHA" ]]
[[ "$TESTED_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$GITHUB_REPOSITORY" == Walker-mfj/TodoCal ]]
image=ghcr.io/walker-mfj/todocal-api
api="repos/$GITHUB_REPOSITORY"
is_current() {
  [[ "$(gh api "$api/git/ref/heads/main" --jq .object.sha)" == "$TESTED_SHA" ]]
}
if ! is_current; then
  echo "Main advanced; newer CI owns publication."
  exit 0
fi
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
tree=$(git rev-parse "$TESTED_SHA:apps/api")
fingerprint=$(git ls-tree -r "$TESTED_SHA" -- apps/api/internal/database/migrations apps/api/internal/database/migrate.go apps/api/start.sh apps/api/go.mod apps/api/go.sum | sha256sum | cut -d' ' -f1)
emit_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
  if is_current; then
    echo "digest=$1" >> "$GITHUB_OUTPUT"
    echo "Tested image: $image@$1"
  else
    echo "Main advanced; newer CI owns delivery."
  fi
}
# Pull only on a disposable runner; unchanged API trees reuse the tested
# digest, including when the earlier workflow never delivered its event.
if docker pull --platform linux/amd64 "$image:tested"; then
  if [[ "$(docker image inspect --format '{{index .Config.Labels "io.todocal.api-tree"}}' "$image:tested")" == "$tree" ]] &&
     [[ "$(docker image inspect --format '{{index .Config.Labels "io.todocal.migrations"}}' "$image:tested")" == "$fingerprint" ]]; then
    ref=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image:tested" | grep -E "^$image@sha256:[0-9a-f]{64}$")
    emit_digest "${ref##*@}"
    exit 0
  fi
fi
# A failed pull (including initial package absence) may cause an extra build,
# but no event is emitted until push completes and the digest is validated.
docker build --platform linux/amd64 \
  --label "org.opencontainers.image.source=https://github.com/Walker-mfj/TodoCal" \
  --label "org.opencontainers.image.revision=$TESTED_SHA" \
  --label "io.todocal.api-tree=$tree" \
  --label "io.todocal.migrations=$fingerprint" \
  --build-arg "GIT_COMMIT=$TESTED_SHA" \
  -t "$image:sha-$TESTED_SHA" apps/api
if ! is_current; then
  echo "Main advanced during build."
  exit 0
fi
docker push "$image:sha-$TESTED_SHA"
if ! is_current; then
  echo "Main advanced before promotion."
  exit 0
fi
docker tag "$image:sha-$TESTED_SHA" "$image:tested"
result=$(docker push "$image:tested")
printf '%s\n' "$result"
digest=$(printf '%s\n' "$result" | sed -nE 's/^tested: digest: (sha256:[a-f0-9]{64}) size: [0-9]+$/\1/p')
emit_digest "$digest"
