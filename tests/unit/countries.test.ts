import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES, findCountry, locationNamesOtherCountry, searchTerms } from "@/lib/rankings/countries";

test("ships ten launch countries with unique slugs", () => {
  assert.equal(COUNTRIES.length, 10);
  assert.equal(new Set(COUNTRIES.map((c) => c.slug)).size, COUNTRIES.length);
});

test("every country has a url-safe slug, names, and cities", () => {
  for (const country of COUNTRIES) {
    assert.match(country.slug, /^[a-z0-9-]+$/);
    assert.ok(country.names.length >= 1, country.slug);
    assert.ok(country.cities.length >= 1, country.slug);
    assert.ok(searchTerms(country).every((term) => term.trim() === term && term.length > 0));
  }
});

test("no term appears in two countries", () => {
  const seen = new Map<string, string>();
  for (const country of COUNTRIES) {
    for (const term of searchTerms(country)) {
      const key = term.toLowerCase();
      assert.equal(seen.get(key), undefined, `${term} in ${country.slug} and ${seen.get(key)}`);
      seen.set(key, country.slug);
    }
  }
});

test("findCountry looks up by slug only", () => {
  assert.equal(findCountry("germany")?.name, "Germany");
  assert.equal(findCountry("Germany"), undefined);
  assert.equal(findCountry("atlantis"), undefined);
});

test("locationNamesOtherCountry excludes locations naming a different country", () => {
  const country = (slug: string) => {
    const found = findCountry(slug);
    assert.ok(found);
    return found;
  };
  assert.equal(locationNamesOtherCountry(country("france"), "Paris, Texas, USA"), true);
  assert.equal(locationNamesOtherCountry(country("united-kingdom"), "London, Ontario, Canada"), true);
  assert.equal(locationNamesOtherCountry(country("germany"), "Berlin, Germany"), false);
  assert.equal(locationNamesOtherCountry(country("germany"), "Berlin"), false);
  assert.equal(locationNamesOtherCountry(country("germany"), null), false);
  assert.equal(locationNamesOtherCountry(country("france"), "Toulouse"), false);
  // Known limitation: Pakistan is not a configured country.
  assert.equal(locationNamesOtherCountry(country("india"), "Hyderabad, Pakistan"), false);
});
