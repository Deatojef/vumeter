# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**vumeter** is a reusable vanilla JavaScript class (GPL v3) that renders a vintage analog VU meter resembling old radio test equipment. It visualizes decibel levels for incoming audio or data and can be embedded in any project that needs dB-level display.

**Stack:** Vanilla JavaScript, SVG, HTML, CSS — no frameworks, no build tools, no dependencies.

## Architecture

- The core is a JavaScript class (`VUMeter` or similar) that consumers instantiate and feed dB values into
- The meter face, needle, scale markings, and housing are rendered with SVG to achieve the analog aesthetic
- CSS handles styling (bezel, glass effect, coloring)
- A demo HTML page (`index.html`) at the repo root serves as both a development harness and usage example

## Repository Layout

- `VUMeter.js` — the reusable meter class
- `VUMeter.css` — base styles
- `demo.css` — demo page styles
- `index.html` — demo / development harness (served via GitHub Pages)
