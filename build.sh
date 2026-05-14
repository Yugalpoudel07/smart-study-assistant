#!/usr/bin/env bash
# build.sh — Render build script for Smart Study Assistant backend
# Render runs this from the backend/ directory (rootDir: backend)

set -e  # exit immediately on any error

echo "==> Installing Python dependencies..."
pip install -r requirements.txt

echo "==> Downloading spaCy English model..."
python -m spacy download en_core_web_sm

echo "==> Verifying spaCy model loads correctly..."
python -c "import spacy; spacy.load('en_core_web_sm'); print('spaCy model OK')"

echo "==> Build complete."
