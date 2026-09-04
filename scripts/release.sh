#!/usr/bin/env bash
# Build, pack and publish the Panoptic Capture extension to the docs hub.
#
#   pnpm release              publishes to https://docs.panoptic.tools
#   HUB=https://... pnpm release   publishes to another hub, such as staging
#
# Needs the 1Password CLI signed in. The signing key and the publish token are
# read from the Employee vault and never written to disk outside a temp dir
# that is removed on exit. Managed browsers pick the new version up on their
# next update check (a few hours) or straight away from chrome://extensions.
set -euo pipefail

HUB="${HUB:-https://docs.panoptic.tools}"
VERSION="$(node -p "require('./package.json').version")"
CRX="panoptic-capture-${VERSION}.crx"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Building ${VERSION}"
sfw pnpm build >/dev/null

echo "Reading the signing key and publish token from 1Password"
op read "op://Employee/Panoptic Capture extension signing key/pem" --out-file "$TMP/key.pem" >/dev/null
TOKEN="$(op read "op://Employee/Panoptic Capture publish token/credential")"

echo "Packing ${CRX}"
sfw pnpm dlx crx3 -p "$TMP/key.pem" -o "$TMP/$CRX" .output/chrome-mv3 >/dev/null

echo "Uploading to ${HUB}"
curl -fsS -X PUT "${HUB}/api/extension/${CRX}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/x-chrome-extension" \
  --data-binary "@$TMP/$CRX"
curl -fsS -X PUT "${HUB}/api/extension/update.xml?version=${VERSION}" \
  -H "Authorization: Bearer ${TOKEN}"

echo "Published. Browsers fetch ${HUB}/extension/update.xml"
