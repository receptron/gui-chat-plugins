# Changelog

## 0.1.0

- First release: the artifact path builders from `@mulmoclaude/core/artifacts` —
  `slugifyArtifact`, `yearMonthUtc`, `buildArtifactRelPath`, `toWorkspaceArtifactPath` and
  `hasUnsafePathSegment` — so a plugin here can name the files it writes under `files.artifacts`
  without depending on MulmoClaude. The directory's name, `ARTIFACTS_ROOT`, is
  `gui-chat-protocol`'s (2.3.0), a peer dependency.
