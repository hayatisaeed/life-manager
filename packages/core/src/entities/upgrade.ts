// Schema upgraders (DATA-MODEL.md §1 "Schema evolution"). Every entity is at
// schema 1 today, so the table is empty. To bump a schema, add
// `UPGRADERS[type][fromVersion] = (data) => newData`; upgraders must be pure
// and must keep fields they don't recognise (move them under `_unknown`).

type Upgrader = (data: Record<string, unknown>) => Record<string, unknown>;

export const UPGRADERS: Record<string, Record<number, Upgrader>> = {};

export function upgradeData(
  type: string,
  from: number,
  data: Record<string, unknown>,
): Record<string, unknown> {
  let v = from;
  let d = data;
  for (;;) {
    const up = UPGRADERS[type]?.[v];
    if (!up) return d;
    d = up(d);
    v += 1;
  }
}
