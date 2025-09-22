# VS Code Copilot Chat - Template to UI Rendering Demo

This document shows the complete flow from templates to final chat UI rendering in VS Code Copilot Chat.

## 🎯 Template Assembly → LM Request → Chat UI Pipeline

### 1. **Template Sources (TSX Components)**

#### SafetyRules.tsx
```tsx
export class SafetyRules extends PromptElement {
    render() {
        return (
            <>
                Follow Microsoft content policies.<br />
                Avoid content that violates copyrights.<br />
                If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with "Sorry, I can't assist with that."<br />
                Keep your answers short and impersonal.<br />
            </>
        );
    }
}
```

#### EditorIntegrationRules.tsx
```tsx
export class EditorIntegrationRules extends PromptElement {
    render() {
        return (
            <>
                Use Markdown formatting in your answers.<br />
                Make sure to include the programming language name at the start of the Markdown code blocks.<br />
                Avoid wrapping the whole response in triple backticks.<br />
                <MathIntegrationRules />
                The user works in an IDE called Visual Studio Code which has a concept for editors with open files, integrated unit test support, an output pane that shows the output of running the code as well as an integrated terminal.<br />
                The active document is the source code the user is looking at right now.<br />
                You can only give one reply for each conversation turn.<br />
            </>
        );
    }
}
```

#### LanguageModelAccessPrompt.tsx (Main Assembly)
```tsx
export class LanguageModelAccessPrompt extends PromptElement<Props> {
    async render() {
        const systemMessages: string[] = [];
        const chatMessages: (UserMessage | AssistantMessage)[] = [];

        // Process each message in the conversation
        for (const message of this.props.messages) {
            if (message.role === vscode.LanguageModelChatMessageRole.System) {
                // Extract system message content
                systemMessages.push(/* filtered content */);
            } else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
                // Process assistant messages with tool calls, thinking, etc.
                chatMessages.push(<AssistantMessage toolCalls={toolCalls}>{content}</AssistantMessage>);
            } else if (message.role === vscode.LanguageModelChatMessageRole.User) {
                // Process user messages and tool results
                chatMessages.push(<UserMessage>{content}</UserMessage>);
            }
        }

        return (
            <>
                <SystemMessage>
                    {this.props.noSafety
                        ? systemMessages
                        : <>
                            <SafetyRules />
                            <EditorIntegrationRules />
                            <br />
                            {systemMessages.join('\n')}
                          </>}
                </SystemMessage>
                {chatMessages}
            </>
        );
    }
}
```

### 2. **Prompt Rendering Process (promptRenderer.ts)**

```typescript
export class PromptRenderer<P extends BasePromptElementProps> extends BasePromptRenderer<P, OutputMode.Raw> {

    public static create<P extends BasePromptElementProps>(
        instantiationService: IInstantiationService,
        endpoint: IChatEndpoint,
        ctor: PromptElementCtor<P, any>,
        props: P,
    ) {
        // Creates renderer with dependency injection
        const hydratedInstaService = instantiationService.createChild(new ServiceCollection([IPromptEndpoint, endpoint]));
        return hydratedInstaService.invokeFunction((accessor) => {
            const tokenizerProvider = accessor.get(ITokenizerProvider);
            return new PromptRenderer(hydratedInstaService, endpoint, ctor, props, tokenizerProvider, ...);
        });
    }

    override async render(): Promise<RenderPromptResult> {
        const result = await super.render(progress, token);

        // Collapse consecutive system messages for CAPI compatibility
        for (let i = 1; i < result.messages.length; i++) {
            const current = result.messages[i];
            const prev = result.messages[i - 1];
            if (current.role === Raw.ChatRole.System && prev.role === Raw.ChatRole.System) {
                // Merge system messages
                prev.content = prev.content.concat(current.content);
                result.messages.splice(i, 1);
                i--;
            }
        }

        return { ...result, references: getUniqueReferences(references) };
    }
}
```

### 3. **Raw Message Format (after template rendering)**

```typescript
interface Raw.ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: Array<{
        type: 'text' | 'image' | 'tool_call' | 'tool_result';
        text?: string;
        image_url?: string;
        // ... other content types
    }>;
    name?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}
```

### 4. **OpenAI API Request Format (responsesApi.ts)**

```typescript
export function createResponsesRequestBody(accessor: ServicesAccessor, options: ICreateEndpointBodyOptions, model: string, modelInfo: IChatModelInformation): IEndpointBody {
    const body: IEndpointBody = {
        model,
        ...rawMessagesToResponseAPI(model, options.messages, !!options.ignoreStatefulMarker),
        stream: true,
        tools: options.requestOptions?.tools?.map((tool): OpenAI.Responses.FunctionTool => ({
            ...tool.function,
            type: 'function',
            strict: false,
            parameters: (tool.function.parameters || {}) as Record<string, unknown>,
        })),
        top_p: options.postOptions.top_p,
        max_output_tokens: options.postOptions.max_tokens,
        tool_choice: options.postOptions.tool_choice,
        temperature: options.postOptions.temperature
    };

    return body;
}
```

### 5. **Response Processing Pipeline**

#### A. Stream Processing (codeBlockProcessor.ts)
```typescript
export class CodeBlockTrackingChatResponseStream extends ChatResponseStreamImpl {

    private processStreamPart(part: ChatResponsePart) {
        if (part instanceof vscode.ChatResponseMarkdownPart) {
            // Process markdown content
            this.processMarkdown(part.value);
        } else if (part instanceof vscode.ChatResponseCodePart) {
            // Process code blocks with syntax highlighting
            this.processCodeBlock(part.value, part.language);
        } else if (part instanceof vscode.ChatResponseReferencePart) {
            // Process file/symbol references
            this.processReference(part.value);
        }
    }

    private processCodeBlock(code: string, language?: string) {
        // Extract code blocks and apply syntax highlighting
        // Convert to ChatResponseCodePart for UI rendering
        this.markdown(`\`\`\`${language || ''}\n${code}\n\`\`\``);
    }
}
```

#### B. Linkification (responseStreamWithLinkification.ts)
```typescript
export class ResponseStreamWithLinkification {

    private linkifyContent(content: string): string {
        // Convert file paths to clickable links
        // Add symbol references
        // Convert URLs to clickable links
        return content.replace(/src\/[^\s]+\.(ts|js|tsx|jsx)/g, (match) => {
            return `[${match}](vscode://file/${workspaceRoot}/${match})`;
        });
    }
}
```

### 6. **Final Chat UI Rendering**

The processed response parts are rendered in VS Code's native Chat UI:

#### ChatResponseTextPart → Markdown
```
User: explain this function
Assistant: This function implements a language model request handler. Here's how it works:

The `provideLanguageModelResponse` method...
```

#### ChatResponseCodePart → Syntax Highlighted Code
```typescript
export class LanguageModelAccess {
    async provideLanguageModelResponse(
        model: vscode.LanguageModelChatInformation,
        messages: Array<vscode.LanguageModelChatMessage>,
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
        token: vscode.CancellationToken
    ): Promise<any> {
        // Implementation
    }
}
```

#### ChatResponseReferencePart → Clickable Links
```
📁 [src/extension/conversation/languageModelAccess.ts](vscode://file/workspace/src/extension/conversation/languageModelAccess.ts)
🔍 [LanguageModelAccess.provideLanguageModelResponse](vscode://goto-symbol?symbol=LanguageModelAccess.provideLanguageModelResponse)
```

#### ChatResponseProgressPart → Status Indicators
```
🤔 Thinking...
⚡ Generating response...
✅ Complete
```

## 🎨 Visual Template Resolution Flow

```
TSX Template:
┌─────────────────────────────────────────────┐
│ <SystemMessage>                             │
│   <SafetyRules />                           │
│   <EditorIntegrationRules />                │
│   {customInstructions}                      │
│ </SystemMessage>                            │
│ <UserMessage>{contextData}</UserMessage>    │
│ <UserMessage>{userQuery}</UserMessage>      │
└─────────────────────────────────────────────┘
                    ↓ PromptRenderer.render()
Raw.ChatMessage[]:
┌─────────────────────────────────────────────┐
│ {                                           │
│   role: "system",                           │
│   content: "Follow Microsoft content       │
│            policies...\nUse Markdown..."    │
│ },                                          │
│ {                                           │
│   role: "user",                             │
│   content: "<workspace>...</workspace>"     │
│ },                                          │
│ {                                           │
│   role: "user",                             │
│   content: "explain this function"          │
│ }                                           │
└─────────────────────────────────────────────┘
                    ↓ createResponsesRequestBody()
OpenAI API Request:
┌─────────────────────────────────────────────┐
│ POST /v1/chat/completions                   │
│ {                                           │
│   "model": "gpt-4",                         │
│   "messages": [...],                        │
│   "stream": true,                           │
│   "tools": [...],                           │
│   "temperature": 0.3                        │
│ }                                           │
└─────────────────────────────────────────────┘
                    ↓ Stream Response
Chat UI Parts:
┌─────────────────────────────────────────────┐
│ ChatResponseTextPart                        │
│ │ ├── Markdown text                         │
│ │ └── Linkified references                  │
│ ChatResponseCodePart                        │
│ │ ├── Syntax highlighted code               │
│ │ └── Copy/apply buttons                    │
│ ChatResponseReferencePart                   │
│ │ ├── File links                            │
│ │ └── Symbol references                     │
│ ChatResponseProgressPart                    │
│   └── Loading indicators                    │
└─────────────────────────────────────────────┘
```

## 🔧 Key Integration Points

1. **Dependency Injection**: `IInstantiationService` provides services to TSX components
2. **Token Management**: `ITokenizerProvider` handles token counting per model
3. **Context Resolution**: Various context providers inject workspace/file context
4. **Tool Integration**: `IToolsService` provides available tools for function calling
5. **Telemetry**: Request/response metrics tracked throughout pipeline
6. **Error Handling**: Graceful degradation and user-friendly error messages

This complete pipeline transforms user input and workspace context into rich, interactive chat responses with syntax highlighting, clickable references, and tool integration.
