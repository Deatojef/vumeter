# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**vumeter** is a nascent project (GPL v3 licensed) with no build system or implementation yet. The `www/` directory is the intended home for web-based source files.

## Current State

- No build system, package manager, or test framework is configured yet
- `www/` is empty — this is where web assets/source will live
- `.claude/settings.local.json` restricts shell permissions to `git config` and `head` commands

## Getting Started

Once a build system is chosen (e.g., npm/Node.js for a web project), update this file with:
- Build command (`npm run build`, etc.)
- Dev server command
- Test command and how to run a single test
