import { useDropzone } from "react-dropzone";
import { Card } from "@/components/ui/card";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  isUploading?: boolean;
}

export function FileUploader({ onFilesSelected, isUploading = false }: FileUploaderProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFilesSelected,
    accept: {
      "text/plain": [".txt"],
      "application/json": [".json"],
    },
    multiple: true,
    disabled: isUploading,
  });

  return (
    <Card
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed cursor-pointer transition-colors",
        isDragActive && "border-primary bg-primary/5",
        isUploading && "opacity-50 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />
      <div className="p-8 text-center">
        <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-lg font-medium">
            {isDragActive ? "Drop files here" : "Drop files here or click to select"}
          </p>
          <p className="text-sm text-muted-foreground">
            Accepts .json and .txt files. Multiple uploads supported.
          </p>
        </div>
      </div>
    </Card>
  );
}
