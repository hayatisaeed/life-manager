import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
const sqlite3 = await sqlite3InitModule();
const db = new sqlite3.oo1.DB(':memory:');
db.exec('create virtual table f using fts5(body)');
db.exec('create table t(id text primary key, type text, data text)');
let t = performance.now();
db.exec('begin');
const st = db.prepare('insert into t values (?,?,?)');
for (let i = 0; i < 50000; i++) {
  st.bind([
    `id${i}`,
    'task',
    JSON.stringify({ title: 'task ' + i, due: '2026-10-' + ((i % 28) + 10) }),
  ]).stepReset();
}
st.finalize();
db.exec('commit');
console.log('insert 50k', (performance.now() - t).toFixed(0), 'ms');
db.exec("create index t_due on t(json_extract(data,'$.due')) where type='task'");
t = performance.now();
const r = db.selectValues(
  "select id from t where type='task' and json_extract(data,'$.due')='2026-10-15'",
);
console.log('indexed json query', r.length, (performance.now() - t).toFixed(1), 'ms');
db.exec("insert into f values ('hello world')");
console.log('fts5', db.selectValues("select body from f where f match 'hello'"));
