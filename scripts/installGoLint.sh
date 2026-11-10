#!/bin/sh
# Install a checksummed upstream release into the repository's ignored local cache.
set -eu
cd "$(dirname "$0")/.."
version=$(cat scripts/tools/golangci-lint.version)
bin=".local/tools/golangci-lint-$version"
case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) echo "Unsupported OS" >&2; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64;; amd64|x86_64) arch=amd64;; *) echo "Unsupported architecture" >&2; exit 1;; esac
mkdir -p .local/tools
tmp=$(mktemp -d .local/tools/install-XXXXXX)
trap 'rm -rf "$tmp"' EXIT
name="golangci-lint-${version#v}-$os-$arch"
url="https://github.com/golangci/golangci-lint/releases/download/$version"
(
  cd "$tmp"
  curl -fsSL --retry 2 "$url/$name.tar.gz" -o "$name.tar.gz"
  curl -fsSL --retry 2 "$url/golangci-lint-${version#v}-checksums.txt" -o sums
  awk -v archive="$name.tar.gz" '$2 == archive {print; found=1} END {exit !found}' sums > checksum
  if command -v sha256sum >/dev/null; then sha256sum -c checksum; else shasum -a 256 -c checksum; fi
  tar -xzf "$name.tar.gz" "$name/golangci-lint"
)
# Archive entries carry the upstream build timestamp; Make tracks local installation.
touch "$tmp/$name/golangci-lint"
mv "$tmp/$name/golangci-lint" "$bin"
