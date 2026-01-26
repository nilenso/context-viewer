/**
 * Centralized prompt management
 * All AI prompts used throughout the application
 */

export type PromptKey =
  | "segmentation"
  | "conversation-summary"
  | "component-identification"
  | "component-mapping"
  | "component-coloring"
  | "context-analysis";

interface PromptTemplate {
  key: PromptKey;
  template: (variables: Record<string, any>) => string;
  description: string;
}

const prompts: Record<PromptKey, PromptTemplate> = {
  segmentation: {
    key: "segmentation",
    description: "Segments large text parts into semantic sections",
    template: ({ text, customPrompt }) => {
      const userPrompt = customPrompt || getDefaultSegmentationPrompt();
      return `${userPrompt}

\`\`\`
${text}
\`\`\`
`;
    },
  },

  "conversation-summary": {
    key: "conversation-summary",
    description: "Generates a high-level summary of the entire conversation",
    template: ({ conversationOverview, customPrompt }) => {
      const userPrompt = customPrompt || getDefaultSummaryPrompt();
      return `${userPrompt}

Conversation:
${JSON.stringify(conversationOverview, null, 2)}`;
    },
  },

  "component-identification": {
    key: "component-identification",
    description: "Identifies components in a conversation for categorization",
    template: ({ conversationJson, customPrompt }) => {
      const userPrompt = customPrompt || getDefaultComponentIdentificationPrompt();
      const outputFormat = `\n\njust give me a list in a json array like this example:\n["abc_document", "xyz_structure", "foo_context", "task", "sources", "breakdown", "reflection", "files_about_bar", "files_about_baz", "tool_calls_about_quix", "xyz blocks", "pqr list"]`;

      return `${userPrompt}${outputFormat}\n\n<conversation>${conversationJson}</conversation>`;
    },
  },

  "component-mapping": {
    key: "component-mapping",
    description: "Maps message part IDs to identified components",
    template: ({ conversationJson, componentsJson }) => `given this conversation and the list of components, give me a mapping
of message part ids in the conversation, to a component from the list, for all the message parts
just give me a simple json object {id: component}

<conversation>${conversationJson}</conversation>
<components>${componentsJson}</components>`,
  },

  "component-coloring": {
    key: "component-coloring",
    description: "Assigns colors to components based on similarity",
    template: ({ componentsJson }) => `Given this list of components, assign a color to each component.
Similar kinds of components should get the same color to make it easy to visually group them.

Available colors: orange, emerald, purple, blue, slate, indigo, gray

Return ONLY a valid JSON object mapping each component to a color name.
Example format: {"component_name": "orange", "another_component": "blue"}

Components:
${componentsJson}`,
  },

  "context-analysis": {
    key: "context-analysis",
    description: "Analyzes conversation context to find opportunities for improvement",
    template: ({ conversationSummary, componentDataCSV }) => `You are analyzing a conversation to identify opportunities for improving context relevance and efficiency.

## Conversation Summary
${conversationSummary}

## Component Distribution Over Time (CSV)
This shows how different context components grew throughout the conversation:

${componentDataCSV}

## Your Task
Analyze this data and provide insights in markdown format covering:

1. **Context Growth Patterns**: What patterns do you see in how context accumulated? Which components dominated?

2. **Redundancy & Efficiency**: Are there signs of redundant context? Which components could potentially be reduced or optimized?

3. **Context Relevance**: Based on the conversation goal, which components seem most/least relevant? Are there disproportionate allocations?

4. **Recommendations**: Specific, actionable suggestions for improving context management in similar conversations. Focus on:
   - Components to reduce or eliminate
   - Better segmentation strategies
   - Context retrieval improvements
   - Memory optimization opportunities

Keep your analysis practical and focused on improving context relevance. Use clear headings, bullet points, and be specific about which components you're referring to.`,
  },
};

/**
 * Get a prompt by key with variable substitution
 */
export function getPrompt(
  key: PromptKey,
  variables: Record<string, any>
): string {
  const promptTemplate = prompts[key];
  if (!promptTemplate) {
    throw new Error(`Prompt not found: ${key}`);
  }
  return promptTemplate.template(variables);
}

/**
 * Get prompt description
 */
export function getPromptDescription(key: PromptKey): string {
  const promptTemplate = prompts[key];
  if (!promptTemplate) {
    throw new Error(`Prompt not found: ${key}`);
  }
  return promptTemplate.description;
}

/**
 * Get all available prompt keys
 */
export function getAllPromptKeys(): PromptKey[] {
  return Object.keys(prompts) as PromptKey[];
}

/**
 * Get the default (user-editable) component identification prompt
 * This is the part shown in the UI without the output format specification
 */
export function getDefaultComponentIdentificationPrompt(): string {
    return `
- identity: Establishes who the AI is, its name, role, and fundamental nature. Defines the relationship between the AI and the user (assistant, partner, tool). Sets the foundation for all subsequent behavioral instructions.

- personality: Governs how the AI communicates, behaves, and presents itself. Covers tone, interaction style, autonomy boundaries, and explicit behavioral constraints that shape the user experience.
- personality.guidelines: General principles for interaction style and response formatting.
- personality.behavior: Constraints on decision-making like avoiding assumptions, not over-engineering, completing tasks fully.
- personality.communication: Output formatting rules including emoji usage, conciseness, reasoning transparency, markdown conventions.
- personality.autonomy: How much independent action the AI can take versus requiring user approval or confirmation.
- personality.model_steering: Emphatic instructions using caps, repetition, and specific prohibitions to override model defaults.
- personality.examples: Concrete scenarios demonstrating expected interaction patterns.

- environment: Runtime context the AI operates within. Includes system information, security boundaries, and platform-specific adaptations.
- environment.platform: OS detection, shell type, working directory, date/time awareness.
- environment.security: Rules around secrets, credentials, dangerous operations, and forbidden actions.
- environment.sandboxing: Network restrictions, file system boundaries, approval requirements for sensitive operations.

- code_style: Standards for generated and modified code. Ensures consistency with project conventions and quality expectations.
- code_style.conventions: Formatting, naming, patterns to match existing codebase style.
- code_style.quality: Security practices, accessibility, performance considerations.
- code_style.examples: Sample code blocks demonstrating expected output format.

- search: How the AI discovers and navigates code. Covers tool selection, search strategies, and context management for exploration tasks.
- search.tool_selection: When to use grep vs glob vs codebase indexing vs sub-agents.
- search.context_separation: How to spawn sub-agents or background tasks for large searches.
- search.examples: Sample search workflows and query patterns.

- workflow: Structured approaches to problem-solving. Includes task tracking, operational modes, and version control practices.
- workflow.task_management: When and how to use todo lists, progress tracking, memory tools.
- workflow.modes: Different operational states like planning, spec, architect, suggest, autopilot.
- workflow.git: Version control operations including commit conventions, branch management, PR creation, and safety constraints.
- workflow.git.commands: Which git commands to use and avoid.
- workflow.git.commits: Message format, conventional commits, co-authoring, footer conventions.
- workflow.examples: Sample workflows for features, bug fixes, refactoring.

- project_context: Instructions for loading user or project-specific configuration. Points to external files that customize AI behavior per workspace.
- project_context.config_files: Paths like CLAUDE.md, AGENTS.md, .gemini/settings, .kiro/steering.

- tools: Everything about tools, their definitions and instructions around when, and how to use them
- tools.policies: Meta-instructions governing tool usage across all tools. Establishes priorities, parallelization rules, and fallback behaviors.
- tools.policies.guidelines: General rules for tool selection, preferring specialized tools over bash.
- tools.policies.model_steering: Emphatic overrides for common model mistakes in tool usage.
- tools.policies.examples: Correct and incorrect tool usage patterns.
- tools.description: What the tool does and its primary purpose.
- tools.conditions: When and where to use versus alternatives.
- tools.usage: How to invoke, required parameters, common patterns.
- tools.schema: Formal parameter definitions, types, constraints.
- tools.file: File system operations for reading, writing, editing, and organizing files. Core capability present in all coding assistants.
- tools.file.read: Viewing file contents, supporting various formats (text, images, notebooks, PDFs).
- tools.file.write: Creating new files, overwriting existing content.
- tools.file.edit: Targeted modifications using search/replace, diffs, or line-based edits.
- tools.file.search: Pattern matching with glob, content search with grep/ripgrep.
- tools.file.directory: Listing, creating, navigating directory structures.
- tools.shell: Terminal and command execution capabilities. Running system commands, background processes, and handling output.
- tools.shell.execution: Running commands, timeout handling, output capture.
- tools.shell.background: Long-running processes, async execution, task monitoring.
- tools.shell.restrictions: Forbidden commands, interactive mode limitations.
- tools.communication: Mechanisms for AI-user interaction beyond chat. Includes questions, confirmations, and structured feedback.
- tools.communication.questions: Asking for clarification, presenting choices, gathering preferences.
- tools.communication.notifications: Progress updates, completion messages, error reporting.
- tools.advanced: Specialized capabilities beyond basic file and shell operations. Present in some but not all assistants.
- tools.advanced.web: Fetching URLs, web search, processing external content.
- tools.advanced.agents: Spawning sub-agents, parallel task execution, background agents.
- tools.advanced.notebooks: Jupyter notebook cell editing and execution.
- tools.advanced.images: Viewing and analyzing screenshots, diagrams, visual content.
- tools.advanced.integrations: MCP servers, external tool protocols, IDE hooks.
`;
}

/**
 * Get the default (user-editable) segmentation prompt
 * This is the part shown in the UI without the text content
 */
export function getDefaultSegmentationPrompt(): string {
  return `Given the following text, tell me where all you would apply a break.
The purpose is semantic chunking in way that's suitable for categorization.
Only give me the top level sections to split the text into coherent topical chunks.
Return ONLY a valid JSON array of regexes with positive lookahead which I can use to run string split on in javascript.

Example response format: ["(?=regex-of-section-1)", "(?=regex-of-section2)"]`;
}

/**
 * Get the default (user-editable) conversation summary prompt
 * This is the part shown in the UI without the conversation content
 */
export function getDefaultSummaryPrompt(): string {
  return `Analyze this conversation and provide a concise summary covering:

1. Goal: What is the main objective or task being discussed?
2. Turns: How many meaningful exchanges occurred? What was the flow?
3. Result: What was accomplished or concluded?

Keep it brief and to the point. Use simple markdown text formatting only (headings, paragraphs, lists, bold).
Do not use code blocks, tables, or complex formatting.`;
}
