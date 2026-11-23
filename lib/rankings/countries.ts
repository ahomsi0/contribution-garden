export interface CountryConfig {
  slug: string;
  name: string;
  /** Values matched against GitHub's free-text profile location. */
  aliases: string[];
}

export const COUNTRIES: readonly CountryConfig[] = [
  {
    slug: "united-states",
    name: "United States",
    aliases: ["United States", "USA", "San Francisco", "New York", "Seattle", "Los Angeles", "Austin", "Boston", "Chicago"],
  },
  {
    slug: "india",
    name: "India",
    aliases: ["India", "Bangalore", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"],
  },
  {
    slug: "germany",
    name: "Germany",
    aliases: ["Germany", "Deutschland", "Berlin", "Munich", "München", "Hamburg", "Cologne", "Frankfurt"],
  },
  {
    slug: "united-kingdom",
    name: "United Kingdom",
    aliases: ["United Kingdom", "UK", "England", "London", "Manchester", "Edinburgh", "Scotland"],
  },
  {
    slug: "france",
    name: "France",
    aliases: ["France", "Paris", "Lyon", "Toulouse", "Marseille", "Nantes"],
  },
  {
    slug: "brazil",
    name: "Brazil",
    aliases: ["Brazil", "Brasil", "São Paulo", "Sao Paulo", "Rio de Janeiro", "Belo Horizonte"],
  },
  {
    slug: "canada",
    name: "Canada",
    aliases: ["Canada", "Toronto", "Vancouver", "Montreal", "Ottawa", "Waterloo"],
  },
  {
    slug: "netherlands",
    name: "Netherlands",
    aliases: ["Netherlands", "Nederland", "Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],
  },
  {
    slug: "japan",
    name: "Japan",
    aliases: ["Japan", "日本", "Tokyo", "東京", "Osaka", "Kyoto"],
  },
  {
    slug: "poland",
    name: "Poland",
    aliases: ["Poland", "Polska", "Warsaw", "Warszawa", "Kraków", "Krakow", "Wrocław"],
  },
];

export function findCountry(slug: string): CountryConfig | undefined {
  return COUNTRIES.find((country) => country.slug === slug);
}
