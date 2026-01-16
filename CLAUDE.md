# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenScreen is a free, open-source screen recording and video editing desktop app (alternative to Screen Studio). Built with Electron + React + TypeScript + Vite + PixiJS.

## Commands

```bash
npm run dev          # Start development server with hot reload
npm run build        # Full build: TypeScript + Vite + electron-builder
npm run build:mac    # Build for macOS
npm run build:win    # Build for Windows
npm run build:linux  # Build for Linux
npm run lint         # ESLint check
npm run test         # Run tests once (vitest)
npm run test:watch   # Run tests in watch mode
```

## Architecture

### Multi-Window Electron App
The app uses multiple window types, routed via `?windowType=` query parameter in `src/App.tsx`:
- **hud-overlay**: Floating recording controls (`src/components/launch/LaunchWindow.tsx`)
- **source-selector**: Screen/app picker dialog (`src/components/launch/SourceSelector.tsx`)
- **editor**: Main video editor (`src/components/video-editor/VideoEditor.tsx`)

### Electron Process Structure
```
electron/
├── main.ts           # App entry, window management, tray
├── windows.ts        # Window factory functions (HUD, Editor, SourceSelector)
├── preload.ts        # IPC bridge - exposes window.electronAPI
└── ipc/handlers.ts   # IPC handlers for file operations, sources, export
```

### Renderer (React) Key Modules
- **Video Editor** (`src/components/video-editor/`): Main editing interface with timeline, playback, settings panels
- **VideoPlayback** utilities in `src/components/video-editor/videoPlayback/`: Math, layout, zoom transforms
- **Export Pipeline** (`src/lib/exporter/`): VideoExporter, GifExporter, frame rendering, MP4 muxing
- **UI Components** (`src/components/ui/`): Radix UI-based components with Tailwind

### Key Technologies
- **PixiJS**: Canvas rendering for video playback with zoom/pan effects
- **dnd-timeline**: Drag-and-drop timeline for zoom regions, trims, annotations
- **mediabunny + mp4box**: Video processing and MP4 muxing
- **gif.js**: GIF export

### Path Alias
`@/` maps to `src/` (configured in vite.config.ts)

## Workflows

See `./.claude/rules/` for detailed workflows:
- `primary-workflow.md` - Implementation flow
- `development-rules.md` - Code standards
- `orchestration-protocol.md` - Agent coordination
- `documentation-management.md` - Docs structure

## Hook Response Protocol

### Privacy Block Hook (`@@PRIVACY_PROMPT@@`)

When a tool call is blocked by the privacy-block hook, the output contains a JSON marker between `@@PRIVACY_PROMPT_START@@` and `@@PRIVACY_PROMPT_END@@`. **You MUST use the `AskUserQuestion` tool** to get proper user approval.

**Required Flow:**

1. Parse the JSON from the hook output
2. Use `AskUserQuestion` with the question data from the JSON
3. Based on user's selection:
   - **"Yes, approve access"** → Use `bash cat "filepath"` to read the file (bash is auto-approved)
   - **"No, skip this file"** → Continue without accessing the file

**Example AskUserQuestion call:**
```json
{
  "questions": [{
    "question": "I need to read \".env\" which may contain sensitive data. Do you approve?",
    "header": "File Access",
    "options": [
      { "label": "Yes, approve access", "description": "Allow reading .env this time" },
      { "label": "No, skip this file", "description": "Continue without accessing this file" }
    ],
    "multiSelect": false
  }]
}
```

**IMPORTANT:** Always ask the user via `AskUserQuestion` first. Never try to work around the privacy block without explicit user approval.

## Python Scripts (Skills)

When running Python scripts from `.claude/skills/`, use the venv Python interpreter:
- **Linux/macOS:** `.claude/skills/.venv/bin/python3 scripts/xxx.py`
- **Windows:** `.claude\skills\.venv\Scripts\python.exe scripts\xxx.py`

This ensures packages installed by `install.sh` (google-genai, pypdf, etc.) are available.

**IMPORTANT:** When scripts of skills failed, don't stop, try to fix them directly.

## [IMPORTANT] Consider Modularization
- If a code file exceeds 200 lines of code, consider modularizing it
- Check existing modules before creating new
- Analyze logical separation boundaries (functions, classes, concerns)
- Use kebab-case naming with long descriptive names, it's fine if the file name is long because this ensures file names are self-documenting for LLM tools (Grep, Glob, Search)
- Write descriptive code comments
- After modularization, continue with main task
- When not to modularize: Markdown files, plain text files, bash scripts, configuration files, environment variables files, etc.

## Documentation Management

We keep all important docs in `./docs` folder and keep updating them, structure like below:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

**IMPORTANT:** *MUST READ* and *MUST COMPLY* all *INSTRUCTIONS* in project `./CLAUDE.md`, especially *WORKFLOWS* section is *CRITICALLY IMPORTANT*, this rule is *MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!*