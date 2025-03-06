import { Octokit } from "octokit";

export default async function getDocsContent(
  octokit: Octokit,
  path: string = "abstract-global-wallet"
): Promise<
  Array<{
    type: string;
    name: string;
    path: string;
    content?: string;
    sha: string;
  }>
> {
  try {
    // Get the contents of the path
    const { data } = await octokit.rest.repos.getContent({
      owner: process.env.DOCS_REPO_OWNER!,
      repo: process.env.DOCS_REPO_NAME!,
      path,
    });

    // If data is an array, it's a directory listing
    if (Array.isArray(data)) {
      // Recursively get content of all files
      const contents = await Promise.all(
        data.map(async (item) => {
          if (item.type === "dir") {
            // Recursively get directory contents
            const dirContents = await getDocsContent(octokit, item.path);
            return dirContents;
          } else if (
            item.type === "file" &&
            (item.name.endsWith(".md") || item.name.endsWith(".mdx"))
          ) {
            // Get file content for markdown files
            const { data: fileData } = await octokit.rest.repos.getContent({
              owner: process.env.DOCS_REPO_OWNER!,
              repo: process.env.DOCS_REPO_NAME!,
              path: item.path,
            });

            if ("content" in fileData) {
              return [
                {
                  type: "file",
                  name: item.name,
                  path: item.path,
                  content: Buffer.from(fileData.content, "base64").toString(
                    "utf-8"
                  ),
                  sha: item.sha,
                },
              ];
            }
          }
          return [];
        })
      );

      return contents.flat();
    }

    return [];
  } catch (error) {
    console.error("Error fetching docs content:", error);
    return [];
  }
}

/**
 * Generates a tree representation of the repository structure
 * @param octokit Octokit instance
 * @param path Optional starting path
 * @returns A string containing the tree representation
 */
export async function generateDirectoryTree(
  items: Array<{
    type: string;
    name: string;
    path: string;
    content?: string;
    sha: string;
  }>,
  path: string = "abstract-global-wallet"
): Promise<string> {
  // Create a structured representation of the directory tree
  const tree: Record<string, any> = {};

  // Process all items to build the directory structure
  items.forEach((item) => {
    const pathParts = item.path.split("/");

    // Skip the root path itself
    if (pathParts.length === 1 && pathParts[0] === path) {
      return;
    }

    // Navigate the tree and create necessary branches
    let currentLevel = tree;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!currentLevel[part]) {
        currentLevel[part] = {};
      }
      currentLevel = currentLevel[part];
    }

    // Add the leaf (file or empty directory)
    const fileName = pathParts[pathParts.length - 1];
    currentLevel[fileName] = item.type === "dir" ? {} : null;
  });

  // Convert the tree object to a string representation
  return renderTree(tree);
}

/**
 * Renders a tree object as a string with proper formatting
 */
function renderTree(tree: Record<string, any>, prefix: string = ""): string {
  const entries = Object.entries(tree);
  let result = "";

  entries.forEach(([key, value], index) => {
    const isLast = index === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    // Add this item to the tree
    const isDir = value !== null;
    result += `${prefix}${connector}${key}${isDir ? "/" : ""}\n`;

    // If it's a directory with children, recursively add its children
    if (isDir && Object.keys(value).length > 0) {
      result += renderTree(value, prefix + childPrefix);
    }
  });

  return result;
}
