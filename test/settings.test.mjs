import assert from "node:assert/strict";
import test from "node:test";

import { describeSource, originPattern, parseSourceList, parseSourceUrl } from "../src/settings.js";

test("sources are https only", () => {
  assert.equal(parseSourceUrl("https://example.com/b.yml").hostname, "example.com");
  assert.throws(() => parseSourceUrl("http://example.com/b.yml"), /must start with https/);
  assert.throws(() => parseSourceUrl("example.com/b.yml"), /not a valid URL/);
});

test("source list: one per line, blanks skipped, errors name the line", () => {
  assert.deepEqual(parseSourceList("\n https://a.example/x.yml \n\nhttps://b.example/y.yml\n"), [
    "https://a.example/x.yml",
    "https://b.example/y.yml",
  ]);
  assert.deepEqual(parseSourceList(""), []);
  assert.throws(() => parseSourceList("https://a.example/x.yml\nhttp://b.example/y.yml"), /^Error: line 2: .*https/);
  assert.throws(() => parseSourceList("https://a.example/x.yml\nhttps://a.example/x.yml"), /line 2: listed twice/);
  for (const twin of ["https://A.example/x.yml", "https://a.example/x.yml#", "https://a.example:443/x.yml"]) {
    assert.throws(() => parseSourceList(`https://a.example/x.yml\n${twin}`), /line 2: listed twice/, twin);
  }
  assert.throws(() => parseSourceList("https://a.example/x.yml https://b.example/y.yml"), /line 1: one URL per line/);
  assert.deepEqual(parseSourceList("https://a.example/x.yml\r\nhttps://b.example/y.yml\r\n"), [
    "https://a.example/x.yml",
    "https://b.example/y.yml",
  ]);
});

test("host permission pattern drops the port", () => {
  assert.equal(originPattern("https://git.example:3000/r/b.yml"), "https://git.example/*");
});

test("status text never shows a source's query or credentials", () => {
  assert.equal(describeSource("https://u:p@git.example/r/b.yml?token=abc"), "git.example/r/b.yml");
});
