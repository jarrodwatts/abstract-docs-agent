export interface Commit {
  added?: string[];
  author: {
    date?: string;
    email: string | null;
    name: string;
    username?: string;
  };
  committer: {
    date?: string;
    email: string | null;
    name: string;
    username?: string;
  };
  distinct: boolean;
  id: string;
  message: string;
  modified?: string[];
  removed?: string[];
  timestamp: string;
  tree_id: string;
  url: string;
}
