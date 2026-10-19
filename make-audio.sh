#!/bin/bash
# Synthesise the fidelity corpus, one clip per take, from fidelity-corpus.json.
#
#   ./make-fidelity-audio.sh          writes audio/take-<n>.wav
#
# The clips are committed, so every release is scored against the same audio: a
# macOS update that changes the voice must not move the number. Re-run this only
# when the corpus version changes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CORPUS="$HERE/fidelity-corpus.json"
VERSION="$(node -e 'console.log(require(process.argv[1]).version)' "$CORPUS")"
VOICE="$(node -e 'console.log(require(process.argv[1]).voice)' "$CORPUS")"
RATE="$(node -e 'console.log(require(process.argv[1]).rate)' "$CORPUS")"
OUT="$HERE/audio"
mkdir -p "$OUT"

COUNT="$(node -e 'console.log(require(process.argv[1]).takes.length)' "$CORPUS")"
for ((i = 0; i < COUNT; i++)); do
  ID="$(node -e 'console.log(require(process.argv[1]).takes[process.argv[2]].id)' "$CORPUS" "$i")"
  TEXT="$(node -e 'console.log(require(process.argv[1]).takes[process.argv[2]].say)' "$CORPUS" "$i")"
  AIFF="$(mktemp -t fidelity).aiff"
  say -v "$VOICE" -r "$RATE" -o "$AIFF" "$TEXT"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$AIFF" "$OUT/take-$ID.wav"
  mv "$AIFF" ~/.Trash/ 2>/dev/null || true
  echo "take $ID → $OUT/take-$ID.wav"
done
