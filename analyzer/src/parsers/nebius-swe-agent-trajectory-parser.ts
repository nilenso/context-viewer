import { ZodError } from "zod";
import type { ConversationMetadata, Parser } from "../model/types";
import { ConversationSchema, type Conversation, type Message } from "../model/schema";
import {
  NebiusSWEAgentTrajectoryInputSchema,
  type NebiusSWEAgentTrajectoryInput,
} from "./input-schemas";

let idCounter = 0;
const generateId = () => `nebius-swe-agent-traj-${++idCounter}`;

export class NebiusSWEAgentTrajectoryParser implements Parser {
  name = "Nebius SWE-agent Trajectory";

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    if (typeof data !== "object" || data === null) return {};
    const trajectory = data as Record<string, unknown>;

    return {
      title: typeof trajectory.instance_id === "string" ? trajectory.instance_id : undefined,
      model: typeof trajectory.model_name === "string" ? trajectory.model_name : undefined,
      provider: "Nebius SWE-agent trajectories",
    };
  }

  canParse(data: unknown): boolean {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    const trajectory = data as Record<string, unknown>;

    return (
      typeof trajectory.instance_id === "string" &&
      typeof trajectory.model_name === "string" &&
      Array.isArray(trajectory.trajectory) &&
      trajectory.trajectory.some((message) => {
        if (typeof message !== "object" || message === null) return false;
        const entry = message as Record<string, unknown>;
        return ["system", "user", "ai"].includes(String(entry.role));
      })
    );
  }

  parse(data: unknown): Conversation {
    try {
      const input = NebiusSWEAgentTrajectoryInputSchema.parse(data);
      return ConversationSchema.parse({
        messages: input.trajectory.flatMap((entry): Message[] => {
          const text = entry.role === "system" ? entry.system_prompt || entry.text : entry.text;
          if (!text) return [];

          return [{
            id: generateId(),
            role: entry.role === "ai" ? "assistant" : entry.role,
            parts: [{ id: generateId(), type: "text", text }],
          }];
        }),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid Nebius SWE-agent trajectory: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }
}
