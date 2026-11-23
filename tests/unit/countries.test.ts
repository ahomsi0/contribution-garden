import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES, findCountry } from "@/lib/rankings/countries";

test("ships ten launch countries with unique slugs", () => {
  assert.equal(COUNTRIES.length, 10);
  assert.equal(new Set(COUNTRIES.map((c) => c.slug)).size, COUNTRIES.length);
});

test("every country has a url-safe slug and at least two aliases", () => {
  for (const country of COUNTRIES) {
    assert.match(country.slug, /^[a-z0-9-]+$/);
    assert.ok(country.aliases.length >= 2, country.slug);
    assert.ok(country.aliases.every((alias) => alias.trim() === alias && alias.length > 0));
  }
});

test("findCountry looks up by slug only", () => {
  assert.equal(findCountry("germany")?.name, "Germany");
  assert.equal(findCountry("Germany"), undefined);
  assert.equal(findCountry("atlantis"), undefined);
});
