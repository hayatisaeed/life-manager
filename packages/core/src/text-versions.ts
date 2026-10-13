import { compareHlc } from './clock';
import { mergeText } from './merge-text';
export interface TextVersion {
  [key: string]: unknown;
  clock: string;
  value: string;
  parents: string[];
}
export type TextGraph = TextVersion[];
/** SYNC.md §6: retain original versions and their causal predecessors, never rendered conflicts. */
export function combineTextGraphs(...graphs: TextGraph[]): TextGraph {
  const nodes = new Map<string, TextVersion>();
  for (const graph of graphs)
    for (const version of graph) {
      const previous = nodes.get(version.clock);
      if (
        previous &&
        (previous.value !== version.value ||
          JSON.stringify([...previous.parents].sort()) !==
            JSON.stringify([...version.parents].sort()))
      )
        throw new Error('Text version clock collision');
      compareHlc(version.clock, version.clock);
      nodes.set(version.clock, { ...version, parents: [...new Set(version.parents)].sort() });
    }
  for (const version of nodes.values())
    for (const parent of version.parents) {
      if (!nodes.has(parent) || compareHlc(parent, version.clock) >= 0)
        throw new Error('Invalid text version ancestry');
    }
  return [...nodes.values()].sort((a, b) => compareHlc(a.clock, b.clock));
}
export function textHeads(graph: TextGraph): TextVersion[] {
  const parents = new Set(graph.flatMap((node) => node.parents));
  return graph.filter((node) => !parents.has(node.clock));
}
export function renderTextGraph(input: TextGraph): { value: string; conflict: boolean } {
  const graph = combineTextGraphs(input),
    heads = textHeads(graph);
  if (heads.length === 0) return { value: '', conflict: false };
  if (heads.length === 1) return { value: heads[0]?.value ?? '', conflict: false };
  const nodes = new Map(graph.map((node) => [node.clock, node]));
  const ancestry = (head: TextVersion) => {
    const found = new Set<string>(),
      pending = [...head.parents];
    while (pending.length) {
      const clock = pending.pop();
      if (clock === undefined || found.has(clock)) continue;
      found.add(clock);
      pending.push(...(nodes.get(clock)?.parents ?? []));
    }
    return found;
  };
  const ancestors = heads.map(ancestry);
  const common = [...graph].reverse().find((node) => ancestors.every((set) => set.has(node.clock)));
  let value = heads[0]?.value ?? '',
    conflict = false;
  for (const head of heads.slice(1)) {
    const next = mergeText(common?.value ?? '', value, head.value);
    value = next.value;
    conflict ||= next.conflict;
  }
  return { value, conflict };
}
export function appendTextVersion(graph: TextGraph, clock: string, value: string): TextGraph {
  return combineTextGraphs(graph, [
    { clock, value, parents: textHeads(graph).map((node) => node.clock) },
  ]);
}
