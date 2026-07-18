import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TaskEditorFieldsProps {
  title: string;
  onTitleChange: (v: string) => void;
  activeTab: string;
  onTabChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
}

export default function TaskEditorFields({
  title,
  onTitleChange,
  activeTab,
  onTabChange,
  description,
  onDescriptionChange,
  prompt,
  onPromptChange,
}: TaskEditorFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>Title</Label>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Task title"
          autoFocus
        />
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="description" className="flex-1">
            Description
          </TabsTrigger>
          <TabsTrigger value="prompt" className="flex-1">
            Prompt
          </TabsTrigger>
        </TabsList>
        <TabsContent value="description" className="mt-2">
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Product/user-facing description..."
            className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
            rows={5}
          />
        </TabsContent>
        <TabsContent value="prompt" className="mt-2">
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="Technical details for AI implementation..."
            className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
            rows={5}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
