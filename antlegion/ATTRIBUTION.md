# Antlegion — Attribution & Acknowledgments

## Derived From OpenClaw

**Project**: [OpenClaw](https://github.com/openclaw/openclaw)
**Author**: Peter Steinberger
**License**: MIT
**Original Copyright**: (c) 2025 Peter Steinberger

Antlegion is an independent implementation of an Agent Runtime for the AntLegion Bus protocol, derived from architectural concepts and design patterns in OpenClaw.

---

## Specific Adaptations

### 1. Agent Runner Architecture

**Source Concept**: OpenClaw's Agent Runner (LLM + tool loop)

**Antlegion Implementation**:
- File: `src/agent/AgentRunner.ts`
- **Independent rewrite** optimized for:
  - Legion Bus event protocol (instead of IM channels)
  - Standalone agent runtime (instead of gateway)
  - Tool loop with error recovery

**Adaptation Details**:
- OpenClaw: Multi-channel agent responding to user messages
- Antlegion: Single agent responding to bus events and scheduled tasks
- Core LLM loop remains similar (tool use, execution, results)

---

### 2. Session Management

**Source Concept**: OpenClaw's Session and Transcript handling

**Antlegion Implementation**:
- Files: `src/agent/Session.ts`, `src/agent/FactMemory.ts`
- **Independent rewrite** for:
  - Per-agent session continuity
  - JSONL-based transcript persistence
  - Fact memory with causal chain loading

**Adaptation Details**:
- Simplified from per-user-per-channel to per-agent-per-runtime
- Transcript format adapted for bus protocol
- Memory compaction strategy unique to Antlegion

---

### 3. Workspace Configuration

**Source Concept**: OpenClaw's workspace (SOUL.md, AGENTS.md, Skills)

**Antlegion Implementation**:
- Files: `src/workspace/loader.ts`, `src/workspace/skills.ts`, `src/agent/SystemPromptBuilder.ts`
- **Similar concept** adapted for:
  - Standalone runtime (no multi-channel complexity)
  - Legion Bus capabilities advertisement
  - Skill injection into system prompts

**Adaptation Details**:
- Kept: SOUL.md for agent personality, skills for capabilities
- Removed: AGENTS.md listing (only one agent per runtime)
- Added: Filter configuration for bus subscription (capabilityOffer, domainInterests)

---

### 4. Plugin System

**Source Concept**: OpenClaw's plugin architecture

**Antlegion Implementation**:
- Files: `src/plugins/loader.ts`, `src/tools/registry.ts`
- **Similar pattern** for:
  - Loading plugins from manifest
  - Registering tools dynamically
  - Plugin isolation

**Adaptation Details**:
- Focused on tool plugins only (no channel plugins)
- Simpler manifest format for Legion Bus agents

---

## Authors

- **Carter.Yang**: Antlegion independent implementation (2025-2026)
  - Architecture design for Legion Bus integration
  - Core runtime rewrite
  - Bus protocol integration
  - Tool scheduling and orchestration systems

- **Peter Steinberger**: OpenClaw original design and implementation (2025)
  - Agent runtime architecture
  - Session and memory management concepts
  - Workspace configuration framework

---

## License

Antlegion is licensed under the **MIT License**, compatible with OpenClaw's original MIT license.

See `LICENSE` file for full text.

---

## Why This Attribution Matters

1. **Academic Integrity**: OpenClaw is original work; Antlegion builds on proven patterns
2. **Community Recognition**: Peter Steinberger's work deserves acknowledgment
3. **License Compliance**: MIT requires attribution in derived works
4. **Professional Ethics**: Transparency builds trust in open source

---

## Contributing

If you improve Antlegion, consider contributing back to OpenClaw:

- OpenClaw: https://github.com/openclaw/openclaw
- Peter's Discord: https://discord.gg/clawd
- This may lead to upstreaming improvements that benefit both projects

---

## Disclaimer

Antlegion is a separate project and is NOT officially affiliated with OpenClaw or Peter Steinberger. It is an independent implementation that learned from OpenClaw's excellent design.

Any issues or bugs in Antlegion are the responsibility of the Antlegion project, not OpenClaw.
