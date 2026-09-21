#!/bin/sh
set -eu

# A named volume masks image ownership. This also upgrades volumes made by old
# root-running images before the server drops privileges.
chown -R rubrik:rubrik /data
exec setpriv --reuid=rubrik --regid=rubrik --init-groups "$@"
