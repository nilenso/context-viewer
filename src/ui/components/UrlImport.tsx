import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Loader2 } from "lucide-react";
import { fetchFileFromUrl } from "@/ui/lib/url-fetch";

interface UrlImportProps {
  onFileImported: (file: File) => void;
}

export function UrlImport({ onFileImported }: UrlImportProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await fetchFileFromUrl(url.trim());

    setIsLoading(false);

    if (result.success) {
      setUrl("");
      onFileImported(result.file);
    } else {
      setError(result.error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isLoading) {
      handleImport();
    }
  };

  return (
    <div className="w-full max-w-md">
      {/* Divider */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 border-t border-border" />
        <span className="text-sm text-muted-foreground">or</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* URL Input Row */}
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="Enter URL..."
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          className="flex-1"
        />
        <Button
          onClick={handleImport}
          disabled={isLoading || !url.trim()}
          variant="outline"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="sr-only">Importing...</span>
            </>
          ) : (
            "Import"
          )}
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <p className="mt-2 text-sm text-destructive text-center">{error}</p>
      )}
    </div>
  );
}
