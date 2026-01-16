# OpenScreen: Project Overview & Product Development Requirements

**Version**: 1.0
**Last Updated**: 2026-01-13
**Status**: In Development (Phase 01 Complete)

## Executive Summary

OpenScreen is a free, open-source desktop application for screen recording and video editing. It provides a modern, user-friendly alternative to commercial tools like Screen Studio and ScreenFlow, with native support for Windows, macOS, and Linux.

**Key Differentiators**:
- Native support for all three major operating systems
- Built-in video editor with timeline-based editing
- Multi-track audio support (camera, system, microphone)
- Export to multiple formats (MP4, GIF, image sequences)
- Open-source and free to use
- Privacy-focused: recording stays on your computer

## Vision

Make professional screen recording and editing accessible to everyone, without barriers of cost or proprietary software limitations.

## Core Values

1. **Privacy First** - All recordings stored locally, never cloud-based
2. **Open Source** - Community-driven development, transparent code
3. **Accessible** - Intuitive UI, support for keyboard navigation
4. **Cross-Platform** - Windows, macOS, Linux with feature parity
5. **Quality** - High-fidelity recording and editing capabilities

## Product Goals

### Phase 1: Foundation (In Progress)
- [x] Media device infrastructure (complete)
- [ ] Camera recording capture
- [ ] Microphone recording
- [ ] System audio capture
- [ ] HUD interface with device selectors
- [ ] Basic video editor timeline

### Phase 2: Core Features (Planned)
- [ ] Multi-track audio editing
- [ ] Zoom region recording
- [ ] Video effects (blur, highlight)
- [ ] Text annotations
- [ ] Basic color correction

### Phase 3: Polish & Scale (Planned)
- [ ] Keyboard shortcuts
- [ ] Plugin system for effects
- [ ] Custom themes
- [ ] Performance optimization
- [ ] Extended codec support

## Product Requirements

### Functional Requirements

#### F1: Media Device Management
- **Description**: Enumerate and manage available cameras, microphones, and system audio
- **Priority**: P0 (Critical)
- **Status**: Phase 01 (Complete)
- **Acceptance Criteria**:
  - User can see list of available cameras
  - User can see list of available microphones
  - User can select camera and microphone for recording
  - System audio option available on macOS 13.2+
  - Device selection persists across app restarts
  - App handles device plug/unplug gracefully

**Related Files**:
- `src/types/media-devices.ts` - Type definitions
- `src/hooks/use-media-devices.ts` - Device enumeration hook
- `src/lib/platform-utils.ts` - macOS version detection

#### F2: Screen Recording
- **Description**: Capture selected screen/window/app with audio
- **Priority**: P0 (Critical)
- **Status**: Phase 02 (Planned)
- **Acceptance Criteria**:
  - User can select screen/window/app to record
  - Recording captures selected region at desired frame rate
  - Camera recording available if camera selected
  - Microphone audio recorded if mic selected
  - System audio recorded if supported and enabled
  - User can stop recording to save video

#### F3: Video Editor
- **Description**: Timeline-based editor for recorded videos
- **Priority**: P0 (Critical)
- **Status**: Phase 05 (Planned)
- **Acceptance Criteria**:
  - User can play, pause, seek through recorded video
  - Timeline shows all audio tracks (camera, system, mic)
  - User can trim video start/end points
  - User can zoom into timeline to edit detailed regions
  - Preview updates in real-time as edits are made
  - Audio waveforms visible for editing precision

#### F4: Video Export
- **Description**: Export edited video to multiple formats
- **Priority**: P1 (High)
- **Status**: Phase 05 (Planned)
- **Acceptance Criteria**:
  - User can export to MP4 format
  - User can export to animated GIF
  - User can configure video quality/bitrate
  - User can select frame rate for GIF export
  - Export progress visible with time estimate
  - Final file saved to user-selected location

#### F5: HUD Interface
- **Description**: Floating overlay window for recording controls
- **Priority**: P0 (Critical)
- **Status**: Phase 05 (Planned)
- **Acceptance Criteria**:
  - HUD window floats above other apps
  - HUD shows recording status (idle, recording, stopped)
  - User can start/stop recording from HUD
  - Device selector visible in HUD
  - HUD size/position customizable

#### F6: Source Selection
- **Description**: Dialog to select screen/window/app to record
- **Priority**: P0 (Critical)
- **Status**: Phase 02 (Planned)
- **Acceptance Criteria**:
  - Dialog shows list of available screens
  - Dialog shows list of open windows
  - Dialog shows list of running applications
  - User can preview selected source
  - Dialog supports keyboard navigation

#### F7: Permission Handling
- **Description**: Request and manage camera/mic permissions
- **Priority**: P1 (High)
- **Status**: Phase 01 (Complete)
- **Acceptance Criteria**:
  - App requests permission before accessing devices
  - Clear explanation shown when permission denied
  - User can grant permission in system settings
  - App gracefully handles denied permissions
  - Re-request permission if user grants it later

### Non-Functional Requirements

#### NF1: Performance
- **Recording**: Achieve target frame rate without dropping frames
  - 1080p 30fps: < 50% CPU usage
  - 4K 30fps: < 80% CPU usage
- **Timeline editing**: 60fps UI interaction
- **Export**: Should complete in reasonable time (< 5x real-time for MP4)

#### NF2: Memory
- **Target**: < 500MB RAM for typical recording session
- **Constraint**: Avoid loading entire video into memory
- **Strategy**: Stream frames, use off-screen rendering

#### NF3: Storage
- **Target**: Efficient video codec (H.264) for file size
- **Constraint**: Support external drives and network storage
- **Requirement**: Validate write permissions before save

#### NF4: Stability
- **Target**: Zero crashes during normal operation
- **Constraint**: Graceful degradation if device unavailable
- **Requirement**: All errors caught and logged

#### NF5: Accessibility
- **Keyboard Navigation**: All features accessible via keyboard
- **Screen Readers**: Support for ARIA labels
- **Color Contrast**: WCAG AA compliance (4.5:1 minimum)
- **Focus Indicators**: Clear focus outlines for keyboard nav

#### NF6: Cross-Platform Compatibility
- **macOS**: 10.14+ (Mojave+), 13.2+ for system audio
- **Windows**: Windows 10 21H2+
- **Linux**: Ubuntu 20.04 LTS+, Fedora 36+

#### NF7: Security
- **Data**: All recordings stored locally, no cloud transmission
- **Permissions**: Only request necessary permissions
- **Updates**: Support secure update mechanism
- **Dependencies**: Regular security audit of dependencies

#### NF8: Usability
- **First-Time User**: Can record first video in < 2 minutes
- **Learning Curve**: Intuitive UI without lengthy tutorials
- **Feedback**: Clear indication of recording status
- **Error Messages**: Helpful, actionable error messages

### Technical Constraints

#### Technology Stack
- **Frontend**: React 18+, TypeScript 5+
- **Desktop**: Electron 30+
- **Build**: Vite, electron-builder
- **Styling**: Tailwind CSS, Radix UI
- **Video**: PixiJS, mediabunny, mp4box, gif.js
- **Testing**: Vitest
- **Package Manager**: npm (npm 9+)

#### Supported Platforms
- macOS 10.14+ (Mojave) - Primary development platform
- Windows 10 21H2+
- Linux (Ubuntu 20.04+, Fedora 36+)

#### Browser/Runtime Requirements
- Chromium (bundled with Electron)
- Node.js 18+ for build/dev

#### Third-Party Dependencies
- See `package.json` for complete list
- Target: Minimize external dependencies
- Strategy: Use Web APIs where possible (navigator.mediaDevices, etc.)

### Success Metrics

#### Phase 01: Media Device Infrastructure
- [x] `useMediaDevices` hook provides device enumeration
- [x] Device selection persists to localStorage
- [x] macOS 13.2+ detection works correctly
- [x] Device validation prevents invalid selections
- [x] Code review passed (score 7.5/10)
- [x] Linting errors resolved
- [x] Unit tests passing (15/15)

#### Phase 02: Camera Recording (Target Metrics)
- [ ] First frame captured within 100ms of record button click
- [ ] No frame drops during 10-minute recording at 1080p 30fps
- [ ] CPU usage < 50% on mid-range machine (i7 2020)
- [ ] Memory usage < 300MB for 10-minute recording
- [ ] 100% test coverage of capture logic

#### Phase 05: HUD Interface (Target Metrics)
- [ ] HUD window renders in < 100ms
- [ ] HUD remains responsive during recording
- [ ] All controls keyboard-accessible
- [ ] Device selector updates in real-time

#### Phase 07: Full Application (Target Metrics)
- [ ] First-time user completes recording in < 2 minutes
- [ ] Zero crashes in 100 1-hour recording sessions
- [ ] Export MP4 at 2x real-time speed
- [ ] macOS/Windows/Linux feature parity
- [ ] 80%+ code coverage

## Architecture Decisions

### Why Electron?
- Native support for Windows, macOS, Linux
- Direct access to system screen capture APIs
- File system access for saving recordings
- Mature ecosystem and tooling

### Why React?
- Component-based UI architecture
- Large ecosystem of libraries
- Excellent developer experience
- Strong community support

### Why PixiJS for Playback?
- Efficient WebGL rendering for video frames
- Support for zoom/pan effects without re-encoding
- Hardware acceleration on all platforms
- Better performance than canvas for frame sequences

### Why TypeScript?
- Catch errors at compile time
- Better IDE support and autocomplete
- Self-documenting code with types
- Easier refactoring and maintenance

### Why localStorage for Device Selection?
- Simple, built-in persistence
- No backend required
- Works offline
- Device IDs are non-sensitive data
- Sufficient for this use case (credentials use system keychain)

## Roadmap

### Q1 2026: Foundation
- [x] Phase 01: Media Device Infrastructure
- [ ] Phase 02: Camera Recording
- [ ] Phase 03: Microphone Recording
- [ ] Phase 04: System Audio Capture

### Q2 2026: Core Features
- [ ] Phase 05: HUD Interface & Device Selectors
- [ ] Phase 06: Timeline Multi-Track Editor
- [ ] Phase 07: Tests & Refinement
- [ ] Beta Release

### Q3 2026: Polish
- [ ] Keyboard shortcuts
- [ ] Advanced timeline features
- [ ] Performance optimization
- [ ] v1.0 Release Candidate

### Q4 2026: Scale
- [ ] Plugin system
- [ ] Extended codec support
- [ ] v1.0 Production Release
- [ ] Community contributions

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Performance issues at 4K | Medium | High | Profile early, optimize critical paths, use Web Workers |
| macOS API changes | Low | Medium | Monitor Apple releases, maintain SDK updates |
| Audio sync issues | Medium | High | Test extensively, implement audio sync verification |
| Cross-platform bugs | High | Medium | Test on all platforms continuously, keep feature parity |
| User permissions denied | High | Low | Show clear explanation, graceful fallback, retry mechanism |

## Resource Requirements

### Team
- 1-2 Frontend developers (React/TypeScript)
- 1 QA tester (manual testing on all platforms)
- 1 Infrastructure/DevOps (CI/CD, releases)

### Infrastructure
- CI/CD pipeline (GitHub Actions)
- Artifact storage for builds
- Code signing certificates (macOS, Windows)

### Timeline
- Phase 01: 1-2 weeks (complete)
- Phase 02-04: 3-4 weeks
- Phase 05-07: 3-4 weeks
- Total: 8-10 weeks to beta

## Success Definition

### MVP (Minimum Viable Product)
- Record screen with camera and microphone audio
- Basic timeline editor with trim functionality
- Export to MP4
- Works on macOS, Windows, Linux
- Zero crashes during normal usage

### v1.0 Production Release
- All features from MVP
- Keyboard shortcuts for all actions
- Multi-track audio editor
- GIF export support
- Text annotations
- 80%+ code coverage

## Future Enhancements

### Phase 2: Advanced Features
- Video effects (blur, highlight)
- Color correction tools
- Custom themes
- Plugin system for effects

### Phase 3: Pro Features
- Cloud export integration (optional, encrypted)
- Advanced color grading
- Motion graphics templates
- Batch export

### Phase 4: Ecosystem
- Browser extension for web recording
- Mobile companion app
- Community effects marketplace
- Premium support tier

## Glossary

| Term | Definition |
|------|-----------|
| HUD | Heads-up Display - floating window with controls |
| IPC | Inter-Process Communication - Electron message passing |
| ScreenCaptureKit | macOS API for screen recording (13.2+) |
| ZoomRegion | Timeline region that can be zoomed/focused |
| Track | Audio or video stream in the editor timeline |
| Export | Converting recorded video to final format (MP4, GIF) |
| Mux | Combining video and audio streams into single file |

## References

- Project Repository: https://github.com/your-org/openscreen
- CLAUDE.md: Project coding guidelines
- System Architecture: `/docs/system-architecture.md`
- Code Standards: `/docs/code-standards.md`
- Development Rules: `/.claude/rules/development-rules.md`
- Documentation Management: `/.claude/rules/documentation-management.md`

## Change Log

### v1.0.0 (2026-01-13)
- Initial PDR document created
- Defined Phase 01 as complete
- Documented success criteria for all phases
- Outlined roadmap through v1.0 release

---

**Document Owner**: Engineering Team
**Last Review**: 2026-01-13
**Next Review**: 2026-02-13
