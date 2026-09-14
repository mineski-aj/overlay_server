#!/bin/bash

cd "$(dirname "$0")"

echo "==============================="
echo "  WebM Re-encoder (1 Mbps)"
echo "==============================="
echo ""

# Check for ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed."
    echo "Install it with: brew install ffmpeg"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

shopt -s nullglob nocaseglob
webm_files=(*.webm)

# Skip files we already produced, so re-running this doesn't re-encode its own output
input_files=()
for f in "${webm_files[@]}"; do
    case "$f" in
        *_1mbps.webm) ;;
        *) input_files+=("$f") ;;
    esac
done

if [ ${#input_files[@]} -eq 0 ]; then
    echo "No .webm files found in this folder."
    echo ""
    read -p "Press Enter to close..."
    exit 0
fi

echo "Found ${#input_files[@]} .webm file(s). Starting re-encode..."
echo ""

success=0
failed=0

for file in "${input_files[@]}"; do
    output="${file%.*}_1mbps.webm"
    echo "Re-encoding: $file -> $output"

    ffmpeg -c:v libvpx-vp9 -i "$file" \
        -vf "format=yuva420p" \
        -c:v libvpx-vp9 \
        -b:v 1M \
        -minrate 1M \
        -maxrate 1M \
        -bufsize 2M \
        -auto-alt-ref 0 \
        -c:a libopus \
        -y "$output" \
        -loglevel error -stats

    if [ $? -eq 0 ]; then
        echo "  Done!"
        ((success++))
    else
        echo "  Failed!"
        ((failed++))
    fi
    echo ""
done

echo "==============================="
echo "Re-encode complete!"
echo "  Succeeded: $success"
echo "  Failed:    $failed"
echo "==============================="
echo ""
read -p "Press Enter to close..."
