#!/bin/sh
# Test-only ephemeral VAPID identity. Never uses production credentials.
# Source this from the repository root before starting the E2E API.
e2e_push_keys="$(node -e "const c=require('node:crypto');const k=c.createECDH('prime256v1');k.generateKeys();const raw=k.getPrivateKey();const priv=Buffer.alloc(32);raw.copy(priv,32-raw.length);console.log(priv.toString('base64url'));console.log(k.getPublicKey().toString('base64url'));")"
VAPID_PRIVATE_KEY="$(printf '%s\n' "$e2e_push_keys" | sed -n '1p')"
VAPID_PUBLIC_KEY="$(printf '%s\n' "$e2e_push_keys" | sed -n '2p')"
VAPID_SUBJECT='mailto:e2e@example.invalid'
export VAPID_PRIVATE_KEY VAPID_PUBLIC_KEY VAPID_SUBJECT
unset e2e_push_keys
