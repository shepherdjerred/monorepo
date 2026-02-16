#!/bin/sh
# Minimal 1x1 transparent PNG (base64)
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > 32x32.png
cp 32x32.png 128x128.png
cp 32x32.png 128x128@2x.png
