import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Task } from "@vibe-kanban/shared";

export default function TaskViewerContent({ task }: { task: Task }) {
  if (!(task.description || task.prompt)) {
    return <p className="text-sm text-muted-foreground italic">No description</p>;
  }

  return (
    <Tabs defaultValue={task.description ? "description" : "prompt"}>
      <TabsList className="w-full">
        {task.description && (
          <TabsTrigger value="description" className="flex-1">
            Description
          </TabsTrigger>
        )}
        {task.prompt && (
          <TabsTrigger value="prompt" className="flex-1">
            Prompt
          </TabsTrigger>
        )}
      </TabsList>
      {task.description && (
        <TabsContent
          value="description"
          className="mt-2 prose prose-sm dark:prose-invert max-w-none"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
        </TabsContent>
      )}
      {task.prompt && (
        <TabsContent value="prompt" className="mt-2 prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.prompt}</ReactMarkdown>
        </TabsContent>
      )}
    </Tabs>
  );
}
