import { useState, useCallback, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { useArtifactContent, useUpdateArtifact } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Eye, Code, Tag } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact } from "@vibe-kanban/shared";

interface ArtifactEditorProps {
  projectId: string;
  artifact: Artifact;
  onBack: () => void;
}

export default function ArtifactEditor({ projectId, artifact, onBack }: ArtifactEditorProps) {
  const { data: contentData, isLoading } = useArtifactContent(projectId, artifact.id);
  const updateArtifact = useUpdateArtifact(projectId);

  const [content, setContent] = useState("");
  const [filename, setFilename] = useState(artifact.filename);
  const [description, setDescription] = useState(artifact.description || "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(artifact.tags);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (contentData?.content) {
      setContent(contentData.content);
    }
  }, [contentData]);

  const isImage = artifact.mimeType.startsWith("image/");
  const isMarkdown = artifact.mimeType === "text/markdown";
  const isJson = artifact.mimeType === "application/json";

  const handleSave = useCallback(() => {
    updateArtifact.mutate(
      {
        id: artifact.id,
        input: { filename, description: description || undefined, tags, content },
      },
      {
        onSuccess: () => {
          setDirty(false);
          onBack();
        },
      },
    );
  }, [artifact.id, filename, description, tags, content, updateArtifact]);

  const handleContentChange = (val: string) => {
    setContent(val);
    setDirty(true);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
      setDirty(true);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
    setDirty(true);
  };

  const extensions = isJson ? [json()] : isMarkdown ? [markdown()] : [];

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={filename}
          onChange={(e) => {
            setFilename(e.target.value);
            setDirty(true);
          }}
          className="h-8 max-w-[300px] font-mono text-sm"
        />
        <Input
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setDirty(true);
          }}
          placeholder="Description..."
          className="h-8 flex-1 text-sm"
        />
        {!isImage && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setPreview(!preview)}
          >
            {preview ? <Code className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
        <Button
          size="sm"
          className="h-8 gap-1.5"
          disabled={!dirty || updateArtifact.isPending}
          onClick={handleSave}
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      </div>

      {/* Tags */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="text-xs cursor-pointer hover:bg-destructive/10"
            onClick={() => removeTag(tag)}
          >
            {tag} x
          </Badge>
        ))}
        <Input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Add tag..."
          className="h-6 w-24 text-xs"
        />
      </div>

      {/* Content */}
      <div
        className="flex-1 min-h-0 border rounded-lg overflow-hidden"
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === "s") {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading...
          </div>
        ) : isImage ? (
          <div className="flex items-center justify-center h-full p-4">
            <img
              src={`data:${artifact.mimeType};base64,${content}`}
              alt={artifact.filename}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        ) : preview && isMarkdown ? (
          <div className="p-4 prose prose-invert prose-sm max-w-none overflow-auto h-full">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <CodeMirror
            value={content}
            height="100%"
            theme="dark"
            extensions={extensions}
            onChange={handleContentChange}
            className="h-full text-sm"
          />
        )}
      </div>
    </div>
  );
}
