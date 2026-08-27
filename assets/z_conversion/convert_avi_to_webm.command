#!/bin/bash

cd "$(dirname "$0")"

echo "==============================="
echo "  AVI to WebM Converter"
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
avi_files=(*.avi)

if [ ${#avi_files[@]} -eq 0 ]; then
    echo "No .avi files found in this folder."
    echo ""
    read -p "Press Enter to close..."
    exit 0
fi

echo "Found ${#avi_files[@]} .avi file(s). Starting conversion..."
echo ""

success=0
failed=0

for file in "${avi_files[@]}"; do
    output="${file%.*}.webm"
    echo "Converting: $file -> $output"

    ffmpeg -i "$file" \
        -c:v libvpx-vp9 \
        -crf 33 \
        -b:v 0 \
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
echo "Conversion complete!"
echo "  Succeeded: $success"
echo "  Failed:    $failed"
echo "==============================="
echo ""
read -p "Press Enter to close..."
