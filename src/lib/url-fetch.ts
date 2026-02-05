/**
 * URL fetch utility for importing conversation files from remote URLs.
 * Handles CORS, validation, and File object creation.
 */

import { SUPPORTED_EXTENSIONS } from "./file-formats";

export type UrlFetchResult =
  | { success: true; file: File }
  | { success: false; error: string };

/**
 * Extract filename from URL path, with fallback.
 */
function extractFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      // Decode URL-encoded characters (e.g., %20 -> space)
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // Invalid URL, use fallback
  }
  return "imported-file";
}

/**
 * Extract file extension from filename.
 */
function getExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length > 1) {
    return "." + parts[parts.length - 1].toLowerCase();
  }
  return "";
}

/**
 * Validate URL format.
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fetch a file from a URL and return it as a File object.
 *
 * Works with:
 * - GitHub raw.githubusercontent.com (public repos)
 * - GitHub Gist raw files (public)
 * - Any server with permissive CORS headers
 *
 * Does not work with:
 * - Private repos (no CORS headers)
 * - GitHub release assets (redirect to S3 without CORS)
 * - Most websites (no CORS headers)
 */
export async function fetchFileFromUrl(url: string): Promise<UrlFetchResult> {
  // Validate URL format
  if (!isValidUrl(url)) {
    return { success: false, error: "Please enter a valid URL" };
  }

  // Extract and validate filename/extension
  const filename = extractFilename(url);
  const extension = getExtension(filename);

  if (!extension) {
    return {
      success: false,
      error: "File type not supported. Use .txt, .md, .json, or .jsonl",
    };
  }

  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return {
      success: false,
      error: "File type not supported. Use .txt, .md, .json, or .jsonl",
    };
  }

  // Fetch the file
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      mode: "cors",
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Server returned ${response.status}: ${response.statusText}`,
      };
    }

    const text = await response.text();

    // Create a File object from the response
    const blob = new Blob([text], { type: "text/plain" });
    const file = new File([blob], filename, { type: "text/plain" });

    return { success: true, file };
  } catch (error) {
    // Check for CORS or network errors
    if (error instanceof TypeError) {
      // TypeError is commonly thrown for CORS blocks and network failures
      return {
        success: false,
        error:
          "Cannot fetch from this URL. Try using a raw GitHub URL (raw.githubusercontent.com) or a server that allows cross-origin requests.",
      };
    }

    return {
      success: false,
      error: `Failed to fetch: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
