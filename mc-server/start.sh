#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ -n "${JAVA_HOME:-}" ]; then
  java_bin="$JAVA_HOME/bin/java"
else
  java_bin="$(command -v java)"
fi
exec "$java_bin" -Dterminal.jline=false -Dterminal.ansi=false -Xms2G -Xmx4G -jar paper.jar --nogui
