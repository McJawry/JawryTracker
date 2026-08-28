// Ported from dev/app/app.js (getYamlBoolean, getYamlListSection,
// cleanYamlValue). Minimal line-based YAML reading for config/spoiler-log
// text - not a general YAML parser, matches the original's scope exactly.

export function cleanYamlValue(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function getYamlBoolean(text: string, key: string): boolean {
  const match = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(true|false)\\b`, "im"));
  return match ? match[1].toLowerCase() === "true" : false;
}

export function getYamlListSection(text: string, sectionName: string): string[] {
  const lines = text.split(/\r?\n/);
  const values: string[] = [];
  const sectionIndex = lines.findIndex((line) => new RegExp(`^\\s*${sectionName}\\s*:`).test(line));
  if (sectionIndex < 0) return values;

  const sectionLine = lines[sectionIndex];
  const inlineMatch = sectionLine.match(/:\s*\[(.*)\]\s*(?:#.*)?$/);
  if (inlineMatch) {
    return inlineMatch[1].split(",").map(cleanYamlValue).filter(Boolean);
  }

  const baseIndent = sectionLine.match(/^\s*/)![0].length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const indent = line.match(/^\s*/)![0].length;
    if (indent <= baseIndent && !line.trimStart().startsWith("-")) break;

    const itemMatch = line.match(/^\s*-\s*(.*?)\s*(?:#.*)?$/);
    if (itemMatch) values.push(cleanYamlValue(itemMatch[1]));
  }

  return values.filter(Boolean);
}
