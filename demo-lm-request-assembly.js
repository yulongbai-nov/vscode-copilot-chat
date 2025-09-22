/**
 * LM REQUEST ASSEMBLY DEMO
 *
 * This script demonstrates how VS Code Copilot Chat assembles Language Model requests
 * from templates to final API calls, showing the actual structure and rendering.
 */

// ==============================
// TEMPLATE STRUCTURE OVERVIEW
// ==============================

console.log(`
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    VS CODE COPILOT CHAT LM REQUEST ASSEMBLY                    │
└─────────────────────────────────────────────────────────────────────────────────┘

## KEY FILES FOR LM REQUEST ASSEMBLY:

### 1. SYSTEM TEMPLATES (TSX Components)
- src/extension/prompts/node/base/safetyRules.tsx
- src/extension/prompts/node/panel/editorIntegrationRules.tsx
- src/extension/conversation/vscode-node/languageModelAccessPrompt.tsx

### 2. PROMPT RENDERING ENGINE
- src/extension/prompts/node/base/promptRenderer.ts
- @vscode/prompt-tsx library (external)

### 3. REQUEST ASSEMBLY PIPELINE
- src/extension/prompt/node/defaultIntentRequestHandler.ts
- src/extension/intents/node/toolCallingLoop.ts
- src/platform/endpoint/node/responsesApi.ts
- src/platform/networking/common/networking.ts

### 4. CHAT UI RENDERING
- src/extension/conversation/vscode-node/languageModelAccess.ts
- src/extension/codeBlocks/node/codeBlockProcessor.ts
`);

// ==============================
// SIMULATED REQUEST ASSEMBLY
// ==============================

const dummyRequest = {
	// 1. SYSTEM MESSAGE ASSEMBLY
	systemMessage: {
		role: 'system',
		content: `Follow Microsoft content policies.
Avoid content that violates copyrights.
If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with "Sorry, I can't assist with that."
Keep your answers short and impersonal.

Use Markdown formatting in your answers.
Make sure to include the programming language name at the start of the Markdown code blocks.
Avoid wrapping the whole response in triple backticks.
Use KaTeX for math equations in your answers.
Wrap inline math equations in $.
Wrap more complex blocks of math equations in $$.
The user works in an IDE called Visual Studio Code which has a concept for editors with open files, integrated unit test support, an output pane that shows the output of running the code as well as an integrated terminal.
The active document is the source code the user is looking at right now.
You can only give one reply for each conversation turn.`
	},

	// 2. CONTEXT SECTION (from various context providers)
	contextData: {
		workspace: {
			name: "vscode-copilot-chat",
			type: "typescript-node-extension",
			dependencies: ["@vscode/prompt-tsx", "typescript", "eslint"],
			structure: {
				"src/": "Extension source code",
				"test/": "Test files",
				"package.json": "Extension manifest"
			}
		},
		activeFile: {
			path: "src/extension/conversation/languageModelAccess.ts",
			language: "typescript",
			content: `export class LanguageModelAccess {
    async provideLanguageModelResponse(/* params */) {
        // Implementation here
    }
}`,
			selection: "provideLanguageModelResponse",
			cursorPosition: { line: 2, character: 15 }
		},
		diagnostics: [
			{
				severity: "error",
				message: "Property 'foo' does not exist on type 'Bar'",
				line: 42,
				file: "src/example.ts"
			}
		],
		relatedFiles: [
			"src/extension/prompts/node/base/promptRenderer.ts",
			"src/platform/endpoint/common/endpointProvider.ts"
		]
	},

	// 3. CONVERSATION HISTORY
	conversationHistory: [
		{
			role: 'user',
			content: 'How does the language model request assembly work?',
			timestamp: new Date('2025-09-22T10:00:00Z')
		},
		{
			role: 'assistant',
			content: 'The LM request assembly follows a pipeline pattern...',
			timestamp: new Date('2025-09-22T10:00:30Z')
		}
	],

	// 4. USER PROMPT (parsed input)
	userPrompt: {
		intent: '@workspace',
		variables: ['#file:languageModelAccess.ts', '#selection'],
		slashCommand: '/explain',
		query: 'please show me where the lm request assembled, please visualize each section and its template'
	},

	// 5. AVAILABLE TOOLS
	tools: [
		{
			name: 'str_replace_in_file',
			description: 'Replace text in a file',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string' },
					oldString: { type: 'string' },
					newString: { type: 'string' }
				}
			}
		},
		{
			name: 'create_file',
			description: 'Create a new file',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string' },
					content: { type: 'string' }
				}
			}
		}
	]
};

// ==============================
// FINAL ASSEMBLED REQUEST
// ==============================

const assembledLMRequest = {
	model: 'gpt-4.1',
	messages: [
		// System message from templates
		dummyRequest.systemMessage,

		// Context injection
		{
			role: 'user',
			content: `<workspace>
Project: ${dummyRequest.contextData.workspace.name}
Type: ${dummyRequest.contextData.workspace.type}
Dependencies: ${dummyRequest.contextData.workspace.dependencies.join(', ')}
</workspace>

<activeFile>
File: ${dummyRequest.contextData.activeFile.path}
Language: ${dummyRequest.contextData.activeFile.language}
Selection: ${dummyRequest.contextData.activeFile.selection}
Content:
\`\`\`${dummyRequest.contextData.activeFile.language}
${dummyRequest.contextData.activeFile.content}
\`\`\`
</activeFile>

<diagnostics>
${dummyRequest.contextData.diagnostics.map(d => `- ${d.severity}: ${d.message} (${d.file}:${d.line})`).join('\n')}
</diagnostics>

<relatedFiles>
${dummyRequest.contextData.relatedFiles.map(f => `- ${f}`).join('\n')}
</relatedFiles>`
		},

		// Conversation history
		...dummyRequest.conversationHistory,

		// Current user query
		{
			role: 'user',
			content: dummyRequest.userPrompt.query
		}
	],

	// Request options
	tools: dummyRequest.tools,
	temperature: 0.3,
	max_tokens: 4096,
	stream: true,
	top_p: 0.95
};

console.log('\n📦 ASSEMBLED LM REQUEST STRUCTURE:');
console.log('=====================================');
console.log(JSON.stringify(assembledLMRequest, null, 2));

// ==============================
// CHAT UI RENDERING PROCESS
// ==============================

console.log(`

┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CHAT UI RENDERING PIPELINE                             │
└─────────────────────────────────────────────────────────────────────────────────┘

## REQUEST → RESPONSE → UI RENDERING FLOW:

### 1. REQUEST DISPATCH
File: src/extension/conversation/vscode-node/languageModelAccess.ts
- CopilotLanguageModelWrapper.provideLanguageModelResponse()
- Applies safety rules and editor integration rules
- Adds token counting and telemetry

### 2. PROMPT RENDERING
File: src/extension/prompts/node/base/promptRenderer.ts
- PromptRenderer.create() → Uses @vscode/prompt-tsx
- Renders TSX components to Raw.ChatMessage[]
- Collapses consecutive system messages
- Adds reference validation

### 3. NETWORK REQUEST
File: src/platform/endpoint/node/responsesApi.ts
- createResponsesRequestBody() → OpenAI API format
- Handles tool calling, streaming, token limits
- Maps VS Code types to OpenAI types

### 4. RESPONSE STREAMING
File: src/extension/codeBlocks/node/codeBlockProcessor.ts
- CodeBlockTrackingChatResponseStream processes response
- Extracts code blocks, applies syntax highlighting
- Handles tool call responses and markdown

### 5. UI UPDATES
File: VS Code Chat UI (native)
- ChatResponseTextPart → Markdown rendering
- ChatResponseCodePart → Syntax highlighted code blocks
- ChatResponseReferencePart → File/symbol links
- ChatResponseProgressPart → Loading indicators

## TEMPLATE RESOLUTION EXAMPLE:

Input TSX:
\`\`\`tsx
<SystemMessage>
    <SafetyRules />
    <EditorIntegrationRules />
    {customInstructions}
</SystemMessage>
\`\`\`

Rendered to:
\`\`\`json
{
    "role": "system",
    "content": "Follow Microsoft content policies...\\nUse Markdown formatting..."
}
\`\`\`

Then sent to OpenAI API as raw message array.
`);

// ==============================
// VISUAL REPRESENTATION
// ==============================

console.log(`

┌─────────────────────────────────────────────────────────────────────────────────┐
│                         VISUAL REQUEST FLOW DIAGRAM                            │
└─────────────────────────────────────────────────────────────────────────────────┘

User Input: "explain this code"
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 1. INTENT PARSING                                                               │
│ defaultIntentRequestHandler.ts                                                   │
│ • Parse @workspace, /explain, #file                                             │
│ • Detect user intent and extract variables                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 2. CONTEXT GATHERING                                                            │
│ Various context providers                                                        │
│ • Workspace context (package.json, file structure)                             │
│ • Active file context (content, language, selection)                           │
│ • Diagnostic context (errors, warnings)                                        │
│ • Related files context (imports, dependencies)                                │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 3. PROMPT TEMPLATE ASSEMBLY                                                     │
│ languageModelAccessPrompt.tsx + promptRenderer.ts                               │
│ • SystemMessage: SafetyRules + EditorIntegrationRules                          │
│ • UserMessage: Context + conversation history + user query                     │
│ • Tool definitions (if tool calling enabled)                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 4. REQUEST FORMATTING                                                           │
│ responsesApi.ts / networking.ts                                                  │
│ • Convert to OpenAI API format                                                  │
│ • Add streaming, temperature, token limits                                      │
│ • Include tools schema and options                                             │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 5. LANGUAGE MODEL API CALL                                                      │
│ External OpenAI/Azure/Anthropic API                                             │
│ • Send assembled request                                                         │
│ • Receive streaming response                                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 6. RESPONSE PROCESSING                                                          │
│ codeBlockProcessor.ts + responseStreamWithLinkification.ts                      │
│ • Parse markdown and code blocks                                                │
│ • Apply syntax highlighting                                                     │
│ • Process tool calls and results                                               │
│ • Add file/symbol references                                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 7. CHAT UI RENDERING                                                            │
│ VS Code Chat Panel (native UI)                                                  │
│ • ChatResponseTextPart → Markdown                                              │
│ • ChatResponseCodePart → Code blocks with syntax highlighting                  │
│ • ChatResponseReferencePart → Clickable file links                             │
│ • ChatResponseProgressPart → Loading/thinking indicators                       │
└──────────────────────────────────────────────────────────────────────────────────┘
    ↓
Final rendered chat response in VS Code UI
`);

console.log('\n✅ Demo completed! This shows the full LM request assembly pipeline in VS Code Copilot Chat.');
