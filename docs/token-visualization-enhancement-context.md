# Token Visualization Enhancement - Implementation Context

**Date Created:** October 2, 2025
**Branch:** `feature/token-usage-visualization`
**Status:** In Progress

## Overview

This document captures the context and implementation plan for enhancing the token usage visualization system in VS Code Copilot Chat. The goal is to provide users with better visibility into token consumption and enable the AI model to be aware of token limits for dynamic management strategies.

## Background

### Current Implementation

The existing token visualization system (`feature/token-usage-visualization` branch) includes:

1. **Core Components:**
   - `PromptTokenUsageMetadata` - Stores token usage information with section-wise breakdown
   - `ChatResponseTokenUsagePart` - Creates formatted displays (summary/detailed modes)
   - `TokenUsageDisplayExample` - Helper utilities for extraction and display

2. **Token Tracking:**
   - Collects usage during prompt assembly
   - Tracks tokens by section: system, user-query, context, tools
   - Identifies truncation and priority levels
   - Calculates usage percentages and limit warnings

3. **Display Mechanism:**
   - Shows token usage through `ChatResponseStream.markdown()`
   - Two modes: summary (compact) and detailed (full breakdown)
   - Visual progress bars using Unicode characters (█░)
   - Warning indicators when approaching limits (>80%)

4. **Configuration:**
   - Experimental setting: `ConfigKey.TokenUsageDisplay` (default: false)
   - Located in: `src/platform/configuration/common/configurationService.ts`

### User Requirements

The user asked for two key enhancements:

1. **Dedicated UI Component:**
   - A specific UI item (not just inline markdown) to display token usage
   - Persistent visibility without cluttering the chat
   - Clickable/interactive elements for management actions

2. **Token-Aware Prompts:**
   - Inject token usage information into prompts sent to the model
   - Enable the model to recognize when to initiate:
     - **Context Compaction:** Summarize conversation history
     - **Subagent Delegation:** Hand off specific tasks to focused agents
   - Dynamic behavior based on token threshold levels

## Proposed Solution Architecture

### 1. Status Bar Token Usage Item

**File:** `/workspace/src/extension/conversation/vscode-node/tokenUsageStatusBar.ts`

**Features:**
- Persistent status bar item on the right side (priority: 100)
- Real-time updates showing: `🟢 1,200/4,000 (30.0%)`
- Visual indicators based on usage:
  - 🟢 0-60%: Optimal (green)
  - 🟡 60-80%: Caution (yellow)
  - ⚠️ 80-95%: Warning (warning background)
  - ⛔ 95%+: Critical (error background)
- Rich tooltip with:
  - Detailed breakdown
  - Top 3 token consumers
  - Actionable command links
- Click to expand: Opens detailed token usage panel
- Command ID: `github.copilot.chat.showDetailedTokenUsage`

**Token Usage Thresholds:**
```typescript
interface TokenThresholds {
  optimal: 0-60,      // Continue normally
  caution: 60-80,     // Monitor usage
  warning: 80-95,     // Recommend actions
  critical: 95-100    // Require immediate action
}
```

### 2. Enhanced ChatResponseTokenUsagePart with Actions

**File:** `/workspace/src/extension/conversation/common/chatResponseTokenUsagePart.ts`

**Enhancements:**
- Add `toMarkdownWithActions()` method
- Include clickable command links based on usage level
- Actions at 80%+ usage:
  - `[Compact Context](command:github.copilot.chat.compactContext)`
  - `[Use Subagent](command:github.copilot.chat.delegateToSubagent)`
  - `[Simplify Query](command:github.copilot.chat.simplifyQuery)`
- Actions at 95%+ usage:
  - `[Clear History](command:github.copilot.chat.clearHistory)`
  - More aggressive recommendations

### 3. Token-Aware Prompt Builder

**File:** `/workspace/src/extension/prompts/common/tokenAwarePromptBuilder.ts`

**Purpose:** Inject token awareness into system prompts based on current usage

**Implementation Strategy:**
```typescript
interface TokenAwarePromptSection {
  content: string;
  tokenCount: number;
  compactionThreshold: number;  // When to trigger compaction (80%)
  subagentThreshold: number;    // When to spawn subagent (85%)
}
```

**Token Management Instructions for Model:**
```markdown
## Token Management Guidelines

Current token usage: 3,400/4,000 (85.0%)

**Token Thresholds:**
- 🟢 Optimal (0-60%): Continue normally
- 🟡 Caution (60-80%): Consider context reduction
- 🔴 Critical (80-95%): MUST compact or delegate
- ⛔ Limit (95%+): Immediate action required

**Available Actions:**
1. **Context Compaction**: Summarize previous conversation
2. **Subagent Delegation**: Hand off specific tasks to focused agents
3. **Response Streaming**: Break response into chunks

**Current Status**: 🔴 Critical - Consider context compaction
```

**Integration Points:**
- Inject into system messages during prompt assembly
- Update dynamically based on real-time token counts
- Conditional injection (only when usage > 60%)

### 4. Token Management Commands

**File:** `/workspace/src/extension/conversation/vscode-node/tokenManagementCommands.ts`

**Commands to Implement:**

#### `github.copilot.chat.compactContext`
- Summarizes conversation history to reduce tokens
- Preserves essential context
- Creates compact representation of previous turns

#### `github.copilot.chat.delegateToSubagent`
- Creates focused subagent with minimal context
- Handles specific subtasks independently
- Returns concise results to main agent

#### `github.copilot.chat.simplifyQuery`
- Helps user rephrase complex queries
- Suggests breaking into smaller parts
- Provides guidance on token-efficient questions

#### `github.copilot.chat.clearHistory`
- Clears conversation history
- Resets token count
- Confirmation dialog for user safety

#### `github.copilot.chat.showDetailedTokenUsage`
- Opens detailed token usage panel
- Shows section-by-section breakdown
- Displays optimization recommendations

### 5. Agent Orchestration with Token Awareness

**File:** `/workspace/src/extension/conversation/vscode-node/tokenAwareAgentOrchestrator.ts`

**Concept:** Automatically trigger subagents based on token thresholds

```typescript
class TokenAwareAgentOrchestrator {
  async processRequest(request: ChatRequest, tokenUsage: IPromptTokenUsageInfo) {
    if (tokenUsage.usagePercentage > 85) {
      // High token usage - delegate to subagent
      return this.delegateToSubagent(request);
    }

    if (tokenUsage.usagePercentage > 70) {
      // Moderate usage - consider compaction
      await this.considerCompaction();
    }

    return this.processNormally(request);
  }
}
```

### 6. Optional: Dedicated Token Usage Panel

**File:** `/workspace/src/extension/conversation/vscode-node/tokenUsagePanel.ts`

**Features:**
- Webview panel showing detailed token analytics
- Real-time updates as conversation progresses
- Historical token usage graphs
- Section-by-section breakdown with charts
- Export token usage reports

**Package.json Contribution:**
```json
"views": {
  "copilot-sidebar": [
    {
      "id": "copilot.tokenUsage",
      "name": "Token Usage Monitor",
      "when": "config.github.copilot.chat.tokenUsage.display"
    }
  ]
}
```

## Implementation Plan

### Phase 1: Core UI Components (In Progress)
- [x] Status Bar Item implementation started
- [ ] Complete status bar with proper VS Code API usage
- [ ] Add command registration
- [ ] Test status bar updates

### Phase 2: Enhanced Actions
- [ ] Update ChatResponseTokenUsagePart with action links
- [ ] Implement token management commands
- [ ] Add command handlers

### Phase 3: Token-Aware Prompts
- [ ] Create TokenAwarePromptBuilder
- [ ] Inject token info into system prompts
- [ ] Test model behavior with token awareness

### Phase 4: Agent Orchestration
- [ ] Implement subagent delegation logic
- [ ] Create context compaction algorithm
- [ ] Test automatic threshold triggers

### Phase 5: Polish & Optional Features
- [ ] Create dedicated token usage panel (optional)
- [ ] Add configuration options
- [ ] Write documentation
- [ ] Create usage examples

## Technical Challenges & Solutions

### Challenge 1: VS Code API Imports
**Problem:** Files in `common/` folders cannot use direct VS Code API imports
**Solution:** Move status bar implementation to `vscode-node/` folder where full API access is available

### Challenge 2: Real-Time Token Updates
**Problem:** Status bar needs to update as prompts are built
**Solution:** Subscribe to prompt assembly events and update status bar in real-time

### Challenge 3: Model Token Awareness
**Problem:** Models don't natively track their token usage
**Solution:** Inject token usage into system messages as structured metadata

### Challenge 4: Context Compaction
**Problem:** How to summarize conversation history effectively
**Solution:** Use separate LLM call to generate compact summaries, preserving key decisions and context

## File Locations

### New Files to Create:
```
/workspace/src/extension/conversation/vscode-node/
  - tokenUsageStatusBar.ts          (Status bar item)
  - tokenManagementCommands.ts      (Command handlers)
  - tokenAwareAgentOrchestrator.ts  (Agent orchestration)
  - tokenUsagePanel.ts              (Optional: Dedicated panel)

/workspace/src/extension/prompts/common/
  - tokenAwarePromptBuilder.ts      (Prompt enhancement)

/workspace/docs/
  - token-visualization-enhancement-context.md (This file)
```

### Files to Modify:
```
/workspace/src/extension/conversation/common/
  - chatResponseTokenUsagePart.ts   (Add action links)

/workspace/package.json
  - Add command contributions
  - Add configuration options
  - Add view contributions (if panel)

/workspace/src/platform/configuration/common/configurationService.ts
  - Add new config keys if needed
```

## Configuration Options

### Existing:
- `github.copilot.chat.tokenUsage.display` (experimental) - Enable/disable display

### Proposed New Settings:
```json
{
  "github.copilot.chat.tokenUsage.statusBar": true,
  "github.copilot.chat.tokenUsage.autoCompact": true,
  "github.copilot.chat.tokenUsage.compactionThreshold": 80,
  "github.copilot.chat.tokenUsage.subagentThreshold": 85,
  "github.copilot.chat.tokenUsage.injectIntoPrompt": true
}
```

## Testing Strategy

### Unit Tests:
- Token threshold calculations
- Status bar rendering logic
- Command execution

### Integration Tests:
- Status bar updates during conversation
- Token-aware prompt injection
- Subagent delegation workflow

### Manual Testing Scenarios:
1. Start conversation, observe status bar appear
2. Build up context until 80% threshold
3. Verify warning indicators and action suggestions
4. Test context compaction command
5. Test subagent delegation
6. Verify token counts decrease after compaction

## Related Documentation

- Original feature docs: `/workspace/docs/token-usage-visualization.md`
- Tools documentation: `/workspace/docs/tools.md`
- VS Code API: Extension guidelines for status bar items

## Next Steps

1. Fix status bar implementation to use proper VS Code API patterns
2. Implement and register token management commands
3. Test end-to-end flow with real prompts
4. Gather feedback on UX and thresholds
5. Iterate on token-aware prompt templates

## Notes & Decisions

- **Decision:** Use status bar instead of dedicated panel as primary UI
  - Rationale: Less intrusive, always visible, quick access

- **Decision:** Set default thresholds at 60/80/95%
  - Rationale: Gives users ample warning before hitting limits

- **Decision:** Make token injection opt-in initially
  - Rationale: Allow testing and validation before enabling for all users

## References

- GitHub Issue: TBD
- Design Doc: This file
- Implementation PR: TBD
