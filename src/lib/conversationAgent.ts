/** Full teaching output is archived independently of the bounded prompt context. */
import type { Db } from "./db";
import type { AgentEvent } from "./agentContracts";
import { archiveContent, type ArchiveContent } from "./conversationContracts";
import { saveConversationAgent } from "./conversationStore";
import type { WorkflowSnapshot } from "./learningWorkflowContracts";

export function conversationRecorder(
  db: Db,
  userId: string,
  conversationId: string,
  messageId: string,
  token: string,
  concepts: readonly { id: string; name: string }[],
) {
  const content: ArchiveContent = archiveContent.parse({
    generatedByLlm: true,
  });
  let workflow: WorkflowSnapshot | null = null;
  return {
    record(event: AgentEvent) {
      if (event.type === "text") content.text += event.text;
      if (event.type === "workflow") workflow = structuredClone(event.workflow);
      if (event.type === "notice")
        content.agentNotices.push({
          level: event.level,
          message: event.message,
        });
      if (event.type === "tool_call")
        content.agentTools.push({
          id: event.id,
          name: event.name,
          serverId: event.serverId,
          argsPreview: event.argsPreview,
          ok: null,
          truncated: false,
          durationMs: null,
          preview: null,
        });
      if (event.type === "tool_result") {
        const trace = content.agentTools.find((item) => item.id === event.id);
        if (trace)
          Object.assign(trace, {
            ok: event.ok,
            truncated: event.truncated,
            durationMs: event.durationMs,
            preview: event.preview,
          });
      }
      if (event.type === "done") {
        workflow = event.workflow ? structuredClone(event.workflow) : workflow;
        content.agentDone = {
          stopReason: event.stopReason,
          steps: event.steps,
          toolCalls: event.toolCalls,
          elapsedMs: event.elapsedMs,
        };
        content.uploadHits = archiveContent.parse({
          uploadHits: event.uploads ?? [],
        }).uploadHits;
        content.materialContext = event.materialContext;
        content.sources = [...(event.materialSources ?? [])];
      }
    },
    async save(
      state: "complete" | "interrupted",
      checkpoint?: { workflow: WorkflowSnapshot; text: string },
    ) {
      const snapshot = checkpoint?.workflow ?? workflow;
      const saved = archiveContent.parse({
        ...content,
        text: checkpoint?.text ?? content.text,
        streaming: false,
      });
      saved.citations = concepts
        .filter((concept) => saved.text.includes(`[${concept.id}]`))
        .map((concept) => ({ kcId: concept.id, title: concept.name }));
      // The entire original context is kept; the reader can display it without querying changed sources.
      if (!saved.text && state === "interrupted")
        saved.note = "本轮生成已中断，可以继续提问或从这里新建分支。";
      return saveConversationAgent(
        db,
        userId,
        conversationId,
        messageId,
        token,
        saved,
        snapshot ? { workflow: snapshot, assessment: null } : null,
        state,
      );
    },
  };
}
