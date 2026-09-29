#!/bin/sh
# VORA container entrypoint (Railway migration §4.2, §6.9).
#
#  1. With backups configured: restore the database from the Litestream replica ONLY when the
#     volume holds no database yet (-if-db-not-exists) and a replica exists (-if-replica-exists).
#     An existing database is never overwritten.
#  2. Run the server as Litestream's child (`litestream replicate -exec`), so replication and the
#     application share one lifecycle: SIGTERM reaches the server, which drains and exits; then
#     Litestream exits with it. Only one replicator ever runs (a volume allows one instance).
#
# Staging and production refuse to start without backups. Credentials come from the R2 variables
# (sealed in Railway) and reach Litestream through its own environment variables — never a file.
set -eu

is_prod_like=0
case "${APP_ENV:-}" in
  staging | production) is_prod_like=1 ;;
esac

config="${LITESTREAM_CONFIG:-/app/litestream.yml}"

if [ "$config" = "/app/litestream.yml" ]; then
  missing=""
  for name in R2_ACCOUNT_ID R2_BUCKET_BACKUPS R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY DATABASE_PATH; do
    eval "value=\${$name:-}"
    [ -n "$value" ] || missing="$missing $name"
  done
  if [ -n "$missing" ]; then
    if [ "$is_prod_like" = "1" ]; then
      echo "{\"level\":\"error\",\"msg\":\"backups_not_configured\",\"message\":\"backups_not_configured\",\"missing\":\"${missing# }\"}" >&2
      exit 1
    fi
    # Development/test without R2: no replication.
    exec "$@"
  fi
  export LITESTREAM_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export LITESTREAM_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
fi

mkdir -p "$(dirname "$DATABASE_PATH")"
litestream restore -config "$config" -if-db-not-exists -if-replica-exists "$DATABASE_PATH"
exec litestream replicate -config "$config" -exec "$*"
