#!/usr/bin/env python3
"""Браузерный smoke. Поднимает игру и гоняет tests/browser-qa.mjs (системный Chrome)."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    completed = subprocess.run(['node', str(ROOT / 'tests' / 'browser-qa.mjs')], cwd=ROOT)
    sys.exit(completed.returncode)


if __name__ == '__main__':
    main()
