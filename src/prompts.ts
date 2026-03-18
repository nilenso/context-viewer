/**
 * Centralized prompt management
 * All AI prompts used throughout the application
 */

export type PromptKey =
  | "segmentation"
  | "conversation-summary"
  | "component-identification"
  | "component-classification"
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
    template: ({ conversationOverview, customPrompt, metadata, stats }) => {
      const userPrompt = customPrompt || getDefaultSummaryPrompt();

      // Build metadata section if available
      let metadataSection = "";
      if (metadata || stats) {
        const lines: string[] = [];
        if (metadata?.parserName) lines.push(`Format: ${metadata.parserName}`);
        if (metadata?.agent) lines.push(`Agent: ${metadata.agent}`);
        if (metadata?.model) lines.push(`Model: ${metadata.model}`);
        if (stats?.messageCount) lines.push(`Messages: ${stats.messageCount}`);
        if (stats?.turnCount) lines.push(`Turns: ${stats.turnCount}`);
        if (stats?.durationMs) {
          const seconds = Math.floor(stats.durationMs / 1000);
          const minutes = Math.floor(seconds / 60);
          const remainingSeconds = seconds % 60;
          lines.push(`Duration: ${minutes}m ${remainingSeconds}s`);
        }
        if (lines.length > 0) {
          metadataSection = `\n\nConversation Metadata:\n${lines.join("\n")}\n`;
        }
      }

      return `${userPrompt}${metadataSection}

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

  "component-classification": {
    key: "component-classification",
    description: "Maps message part IDs to identified components",
    template: ({ conversationJson, componentsJson, componentDescriptions }) => `given this conversation and the list of components, give me a mapping
of message part ids in the conversation, to a component from the list, for all the message parts
just give me a simple json object {id: component}

<component-descriptions>${componentDescriptions}</component-descriptions>
<conversation>${conversationJson}</conversation>
<components>${componentsJson}</components>`,
  },

  "component-coloring": {
    key: "component-coloring",
    description: "Assigns colors to components based on similarity",
    template: ({ componentsJson, customPrompt }) => {
      const userPrompt = customPrompt || getDefaultColoringPrompt();
      return `${userPrompt}

Components:
${componentsJson}`;
    },
  },

  "context-analysis": {
    key: "context-analysis",
    description: "Analyzes conversation context to find opportunities for improvement",
    template: ({ conversationSummary, componentDataCSV, customPrompt }) => {
      const userPrompt = customPrompt || getDefaultAnalysisPrompt();
      return `${userPrompt}

## Conversation Summary
${conversationSummary}

## Component Distribution Over Time (CSV)
This shows how different context components grew throughout the conversation:

${componentDataCSV}`;
    },
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
    return `Given this conversation, give me a list of all the topics. Each topic can be 3 to 4 words in length. Topics can also be hierarchical like topic.sub_topic_1, topic.sub_topic_2.`;
}

/**
 * Get the default (user-editable) segmentation prompt
 * This is the part shown in the UI without the text content
 */
export function getDefaultSegmentationPrompt(): string {
  return `Given the following text, tell me where all you would apply a break.
The purpose is semantic chunking in way that's suitable for categorization. Use markdown headings.

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

/**
 * Get the default (user-editable) context analysis prompt
 * This is the part shown in the UI without the data sections
 */
export function getDefaultAnalysisPrompt(): string {
  return `You are analyzing a conversation to identify opportunities for improving context relevance and efficiency.

Analyze the data below and provide insights in markdown format covering:

1. **Context Growth Patterns**: What patterns do you see in how context accumulated? Which components dominated?

2. **Redundancy & Efficiency**: Are there signs of redundant context? Which components could potentially be reduced or optimized?

3. **Context Relevance**: Based on the conversation goal, which components seem most/least relevant? Are there disproportionate allocations?

4. **Recommendations**: Specific, actionable suggestions for improving context management in similar conversations. Focus on:
   - Components to reduce or eliminate
   - Better segmentation strategies
   - Context retrieval improvements
   - Memory optimization opportunities

Keep your analysis practical and focused on improving context relevance. Use clear headings, bullet points, and be specific about which components you're referring to.`;
}

/**
 * Get the default (user-editable) component coloring prompt
 * This is the part shown in the UI without the components list
 */
export function getDefaultColoringPrompt(): string {
  return `Given this list of components, assign a color to each component.
Similar kinds of components should get the same color to make it easy to visually group them.

Available colors: orange, emerald, purple, blue, slate, indigo, gray, cyan, teal, rose, amber, violet, lime, sky

Return ONLY a valid JSON object mapping each component to a color name.
Example format: {"component_name": "orange", "another_component": "blue"}`;
}
