# Token Usage Visualization Documentation

## Overview

The token usage visualization feature provides comprehensive insights into prompt token consumption within the GitHub Copilot Chat extension. This feature helps users understand how their prompts utilize the available token budget and optimize their queries for better performance.

## Features

### 1. Real-time Token Tracking
- **Automatic calculation** of token usage across all prompt components
- **Section-wise breakdown** showing individual contribution of system prompts, user queries, context, and tools
- **Usage percentage** with visual indicators and warnings
- **Truncation detection** to identify when content has been shortened

### 2. Multiple Display Formats
- **Summary View**: Concise overview with key metrics
- **Detailed View**: Complete breakdown with optimization suggestions
- **Compact Format**: Minimal display for space-constrained scenarios

### 3. Smart Warnings and Suggestions
- **Near-limit warnings** when approaching token capacity
- **Optimization recommendations** for high usage scenarios
- **Truncation alerts** when content has been shortened

## Configuration

The token usage visualization can be controlled through VS Code settings:

### Enable/Disable Display
```json
{
  "github.copilot.chat.tokenUsage.display": true
}
```

**Default:** `true`
**Description:** Controls whether token usage information is displayed in chat responses.

## Usage Examples

### Basic Token Usage Information

When enabled, token usage information appears in chat responses:

#### Summary Display
```
🎯 **Token Usage:** 1,200/4,000 tokens (30.0%)
- **Model:** gpt-4
- **Status:** ✅ Optimal usage
```

#### Detailed Breakdown
```
📊 **Token Usage Breakdown**

| Component | Tokens | Priority | Truncated |
|-----------|--------|----------|-----------|
| System | 400 | 1 | ❌ |
| User Query | 300 | 2 | ❌ |
| Context | 400 | 3 | ❌ |
| Tools | 100 | 4 | ❌ |

**Total:** 1,200/4,000 tokens (30.0%)
**Model:** gpt-4
**Status:** ✅ Optimal usage
```

### High Usage Scenario with Warnings

When token usage exceeds 80%:

```
⚠️ **Token Usage:** 3,200/4,000 tokens (80.0%)
- **Model:** gpt-4
- **Status:** ⚠️ Near limit

## Optimization Suggestions
Consider:
- Simplifying your question or breaking it into smaller parts
- Reducing the amount of context or code examples included
- Using more specific queries to get targeted responses
```

### Compact Format

For space-constrained displays:
```
2,000/4,000 tokens (50.0%)
```

Or with warnings:
```
⚠️ 3,200/4,000 tokens (80.0%)
```

## Integration with Prompts

### Automatic Integration

The token usage visualization automatically integrates with the prompt system:

1. **Metadata Collection**: Token counts are gathered during prompt assembly
2. **Response Integration**: Usage information is embedded in chat responses
3. **Configuration Respect**: Display follows user settings

### Programmatic Access

For developers extending the system:

```typescript
import { PromptTokenUsageMetadata } from './promptTokenUsageMetadata';
import { ChatResponseTokenUsagePart } from './chatResponseTokenUsagePart';

// Create metadata from prompt sections
const metadata = new PromptTokenUsageMetadata(
    tokenUsageInfo,
    sections
);

// Generate response part
const usagePart = new ChatResponseTokenUsagePart(
    metadata.tokenUsageInfo,
    'detailed' // or 'summary'
);

// Get markdown representation
const markdown = usagePart.toMarkdown();
```

## Understanding Token Usage Data

### Token Usage Information Structure

```typescript
interface IPromptTokenUsageInfo {
    totalTokens: number;        // Total tokens used
    maxTokens: number;          // Maximum available tokens
    usagePercentage: number;    // Percentage of tokens used
    modelName: string;          // AI model being used
    isNearLimit: boolean;       // True if usage > 80%
    sections: Array<{
        section: string;        // Section name (system, user-query, etc.)
        tokenCount: number;     // Tokens used by this section
        priority: number;       // Processing priority (1 = highest)
        wasTruncated: boolean;  // True if content was shortened
    }>;
}
```

### Section Types

- **system**: System prompts and instructions
- **user-query**: User's actual question or request
- **context**: Code context, workspace information
- **tools**: Available tools and their descriptions
- **conversation**: Previous conversation history

### Priority System

Lower numbers indicate higher priority:
1. **System prompts** (priority 1): Essential instructions
2. **User queries** (priority 2): Direct user input
3. **Context** (priority 3): Supporting information
4. **Tools** (priority 4): Available capabilities

## Performance Considerations

### Token Counting

- Token counting is performed during prompt assembly
- Minimal performance impact on chat interactions
- Counts are cached and reused where possible

### Display Impact

- Token usage display adds minimal visual overhead
- Can be disabled via configuration if not needed
- Compact format available for reduced visual impact

## Troubleshooting

### Token Usage Not Displaying

1. Check configuration setting: `github.copilot.chat.tokenUsage.display`
2. Ensure extension is updated to latest version
3. Restart VS Code if issues persist

### Inaccurate Token Counts

1. Token counts are estimates based on model tokenization
2. Actual API usage may vary slightly
3. Counts include all prompt components (system, user, context, tools)

### Performance Issues

1. Token usage calculation has minimal performance impact
2. If experiencing slowdown, consider disabling via settings
3. Report persistent issues through VS Code extension feedback

## Advanced Usage

### Custom Display Integration

For custom integrations, use the `TokenUsageDisplayExample` utility:

```typescript
import { TokenUsageDisplayExample } from './tokenUsageDisplayExample';

// Extract token usage from prompt result
const usage = TokenUsageDisplayExample.extractTokenUsage(promptResult);

// Create custom display
if (usage) {
    const customDisplay = new TokenUsageDisplayExample(usage, 'custom');
    const markdown = customDisplay.generateMarkdown();
}
```

### Configuration Automation

Automate token usage settings through workspace configuration:

```json
{
    "github.copilot.chat.tokenUsage.display": true,
    "github.copilot.chat.advanced.tokenDisplay": "detailed"
}
```

## Best Practices

### Optimizing Token Usage

1. **Be specific**: Targeted questions use fewer tokens
2. **Limit context**: Include only relevant code/files
3. **Break down complex queries**: Multiple simple questions vs. one complex question
4. **Monitor warnings**: Act on near-limit warnings

### Effective Monitoring

1. **Regular review**: Check token usage patterns
2. **Identify hotspots**: Find sections consuming most tokens
3. **Optimize workflows**: Adjust based on usage patterns
4. **Balance detail vs. efficiency**: Choose appropriate display level

## API Reference

### Core Classes

#### `PromptTokenUsageMetadata`
- **Purpose**: Collects and organizes token usage information
- **Usage**: Automatically created during prompt processing
- **Methods**: `createFromSections()`, metadata access

#### `ChatResponseTokenUsagePart`
- **Purpose**: Generates user-facing token usage displays
- **Usage**: Creates markdown representations for chat responses
- **Methods**: `toMarkdown()`, `toCompactString()`

#### `TokenUsageDisplayExample`
- **Purpose**: Utility for extracting and formatting token usage
- **Usage**: Helper for custom integrations and testing
- **Methods**: `extractTokenUsage()`, `generateMarkdown()`

### Configuration Keys

- `github.copilot.chat.tokenUsage.display`: Boolean to enable/disable display
- Future: Additional granular controls as needed

## Version History

### v1.0.0 (Current)
- Initial implementation of token usage visualization
- Summary and detailed display formats
- Configuration control
- Integration with chat responses
- Comprehensive testing suite

## Support

For issues, feature requests, or questions:
1. Check this documentation
2. Search existing VS Code Copilot extension issues
3. File new issue with detailed reproduction steps
4. Include configuration and error logs when applicable
