export interface CountryConfig {
  slug: string;
  name: string;
  /** Country-level terms. Also used to exclude people whose location names a different configured country. */
  names: readonly string[];
  /** City terms, searched but never used for exclusion. */
  cities: readonly string[];
}

export function searchTerms(country: CountryConfig): string[] {
  return [...country.names, ...country.cities];
}

// "England" is deliberately absent (it also matches "New England" in the US),
// and so is "US" (it would match the English word "us").
export const COUNTRIES: readonly CountryConfig[] = [
  {
    slug: "united-states",
    name: "United States",
    names: ["United States", "United States of America", "USA"],
    cities: ["San Francisco", "New York", "NYC", "Seattle", "Los Angeles", "Austin", "Boston", "Chicago", "Silicon Valley"],
  },
  {
    slug: "india",
    name: "India",
    names: ["India", "Bharat"],
    cities: ["Bangalore", "Bengaluru", "Mumbai", "Delhi", "New Delhi", "Hyderabad", "Pune", "Chennai", "Gurgaon", "Gurugram", "Noida", "Kolkata"],
  },
  {
    slug: "germany",
    name: "Germany",
    names: ["Germany", "Deutschland"],
    cities: ["Berlin", "Munich", "München", "Hamburg", "Cologne", "Köln", "Frankfurt", "Stuttgart"],
  },
  {
    slug: "united-kingdom",
    name: "United Kingdom",
    names: ["United Kingdom", "UK", "Great Britain", "Scotland", "Wales"],
    cities: ["London", "Manchester", "Edinburgh", "Glasgow", "Bristol", "Cambridge"],
  },
  {
    slug: "france",
    name: "France",
    names: ["France"],
    cities: ["Paris", "Lyon", "Toulouse", "Marseille", "Nantes", "Bordeaux", "Lille"],
  },
  {
    slug: "brazil",
    name: "Brazil",
    names: ["Brazil", "Brasil"],
    cities: ["São Paulo", "Sao Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Porto Alegre"],
  },
  {
    slug: "canada",
    name: "Canada",
    names: ["Canada"],
    cities: ["Toronto", "Vancouver", "Montreal", "Ottawa", "Waterloo", "Calgary"],
  },
  {
    slug: "netherlands",
    name: "Netherlands",
    names: ["Netherlands", "The Netherlands", "Nederland", "Holland"],
    cities: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven", "The Hague", "Den Haag"],
  },
  {
    slug: "japan",
    name: "Japan",
    names: ["Japan", "日本"],
    cities: ["Tokyo", "東京", "Osaka", "Kyoto", "Yokohama"],
  },
  {
    slug: "poland",
    name: "Poland",
    names: ["Poland", "Polska"],
    cities: ["Warsaw", "Warszawa", "Kraków", "Krakow", "Wrocław", "Wroclaw", "Gdańsk", "Gdansk"],
  },
];

export function findCountry(slug: string): CountryConfig | undefined {
  return COUNTRIES.find((country) => country.slug === slug);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(location: string, term: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "iu").test(location);
}

/** True when a profile location names a different configured country, e.g. "Paris, Texas, USA" for France. */
export function locationNamesOtherCountry(country: CountryConfig, location: string | null): boolean {
  if (!location) return false;
  return COUNTRIES.some(
    (other) => other.slug !== country.slug && other.names.some((term) => mentions(location, term)),
  );
}
