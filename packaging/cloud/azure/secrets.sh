#!/bin/bash
# OpsPoint on Azure: the deployment script (main.bicep) that keeps OpsPoint's secrets in Key Vault.
# Each is made once and left alone at every later deployment: a new session secret would sign
# everyone out, a new push seed would cut off every phone, a new database password would lock the
# app out of its database. VAULT comes from main.bicep.
set -euo pipefail

# The role that lets this script write secrets can take minutes to reach the vault.
for i in $(seq 1 40); do
  if az keyvault secret list --vault-name "$VAULT" --maxresults 1 --output none 2>/dev/null; then break; fi
  [ "$i" = 40 ] && { echo "Key Vault $VAULT still refuses this script's identity." >&2; exit 1; }
  sleep 15
done

# 0 = there, 1 = not there; anything else (no access, no network) stops the script, so a passing
# fault can never be mistaken for a missing secret and replace a good one.
exists() {
  local out
  if out=$(az keyvault secret show --vault-name "$VAULT" --name "$1" --query id --output tsv 2>&1); then return 0; fi
  case "$out" in *SecretNotFound*|*"was not found"*) return 1 ;; esac
  echo "Can't tell whether $1 is in $VAULT: $out" >&2
  exit 1
}
# About 60 random letters and digits, with at least one of each kind (Azure's database passwords
# need three kinds of character); safe in a URL and as a Postgres password.
random() {
  local s=""
  until [[ $s =~ [A-Z] && $s =~ [a-z] && $s =~ [0-9] ]]; do
    s=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')
  done
  printf '%s' "$s"
}

for name in session-secret vapid-seed postgres-password; do
  if exists "$name"; then
    echo "$name: kept"
  else
    az keyvault secret set --vault-name "$VAULT" --name "$name" --value "$(random)" --output none
    echo "$name: made"
  fi
done

# The vault's name as the script's output: main.bicep hands it to database.bicep (see there).
if [ -n "${AZ_SCRIPTS_OUTPUT_PATH:-}" ]; then
  printf '{"vault":"%s"}' "$VAULT" > "$AZ_SCRIPTS_OUTPUT_PATH"
fi
