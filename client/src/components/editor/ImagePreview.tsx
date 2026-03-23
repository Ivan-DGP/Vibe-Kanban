interface ImagePreviewProps {
  content: string;
  fileName: string;
}

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

export default function ImagePreview({ content, fileName }: ImagePreviewProps) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "png";
  const mime = EXT_MIME[ext] || "image/png";

  return (
    <div className="flex items-center justify-center h-full p-4">
      <img
        src={`data:${mime};base64,${content}`}
        alt={fileName}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
