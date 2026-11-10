export function isAbsolutePath(value: string): boolean {
  return value.trim().startsWith("/");
}

export function normalizePath(value: string): string {
  const parts = value.trim().split("/").filter((part) => part !== "" && part !== ".");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return `/${stack.join("/")}`;
}

export function parentPath(value: string): string {
  const clean = normalizePath(value);
  if (clean === "/") return "/";
  const index = clean.lastIndexOf("/");
  return index <= 0 ? "/" : clean.slice(0, index);
}

export function splitPathInput(value: string): { dir: string; prefix: string } {
  const clean = value.trim();
  if (!isAbsolutePath(clean)) return { dir: "", prefix: clean };
  const completed = clean.endsWith("/");
  const trimmed = clean.replace(/\/+$/, "") || "/";
  if (trimmed === "/") return { dir: "/", prefix: "" };
  if (completed) return { dir: trimmed, prefix: "" };
  const index = trimmed.lastIndexOf("/");
  return {
    dir: index <= 0 ? "/" : trimmed.slice(0, index),
    prefix: trimmed.slice(index + 1),
  };
}

export function matchFolders(names: string[], prefix: string): string[] {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return names;
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(needle)) starts.push(name);
    else if (lower.includes(needle)) contains.push(name);
  }
  return [...starts, ...contains];
}

export function isFolderName(name: string, prefix: string): boolean {
  return name.toLowerCase() === prefix.trim().toLowerCase();
}

export function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

export function pathCrumbs(value: string): { label: string; path: string }[] {
  const crumbs = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of normalizePath(value).split("/").filter(Boolean)) {
    current += `/${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}
