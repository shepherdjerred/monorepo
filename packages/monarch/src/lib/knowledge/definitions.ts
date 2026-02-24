import type { MonarchCategory } from "../monarch/types.ts";
import type { CategoryDefinition } from "./types.ts";

// Category definitions with descriptions, examples, and anti-examples.
// These are included in classifier prompts so Claude knows exactly what each category covers.
const CATEGORY_METADATA: Record<
  string,
  { description: string; examples: string[]; notThisCategory: string[] }
> = {
  "Coffee Shops": {
    description:
      "Coffee shops, cafes, and tea houses. Includes bakery/cafe combos. Does NOT include full-service restaurants that happen to serve coffee.",
    examples: [
      "Starbucks",
      "Piedmont",
      "Victrola",
      "Espresso Vivace",
      "Caffe Vita",
      "Blue Bottle",
      "Half and Doughnut Co",
    ],
    notThisCategory: [
      "Restaurants that serve coffee as a side item",
      "Grocery store coffee purchases",
    ],
  },
  "Restaurants & Bars": {
    description:
      "Full-service and fast-food restaurants, bars, pubs, and takeout orders. Does NOT include coffee shops.",
    examples: [
      "Chipotle",
      "DoorDash",
      "Uber Eats",
      "local restaurants",
      "bars and pubs",
    ],
    notThisCategory: ["Coffee shops (use Coffee Shops)", "Grocery delivery"],
  },
  Groceries: {
    description:
      "Grocery stores and supermarkets when buying food/household essentials. For warehouse clubs (Costco), use Groceries only when items are food/household consumables.",
    examples: [
      "Safeway",
      "QFC",
      "Whole Foods",
      "Trader Joe's",
      "grocery delivery",
    ],
    notThisCategory: [
      "Non-food items at grocery stores (use Shopping)",
      "Restaurant meals (use Restaurants & Bars)",
    ],
  },
  Shopping: {
    description:
      "General retail purchases including clothing, accessories, beauty products, general merchandise. Includes online marketplaces when buying consumer goods.",
    examples: [
      "Target",
      "Nordstrom",
      "Zara",
      "Byredo",
      "Paka",
      "general Amazon purchases",
    ],
    notThisCategory: [
      "Electronics (use Electronics)",
      "Furniture (use Furniture & Housewares)",
      "Software subscriptions (use Software)",
    ],
  },
  Software: {
    description:
      "Software subscriptions, cloud services, app purchases, and digital tools. Includes SaaS, development tools, AI services, and app store subscriptions.",
    examples: [
      "Anthropic",
      "Cursor",
      "Docker",
      "OpenAI",
      "Kagi",
      "PagerDuty",
      "Google Cloud",
      "Apple App Store subscriptions",
    ],
    notThisCategory: [
      "Streaming entertainment (use Entertainment & Recreation)",
      "Physical electronics (use Electronics)",
    ],
  },
  Electronics: {
    description:
      "Physical electronic devices, hardware, and accessories. Includes computers, phones, audio equipment, cameras.",
    examples: [
      "Apple Store (hardware)",
      "Best Buy",
      "U-Turn Audio",
      "computer accessories",
    ],
    notThisCategory: [
      "Software subscriptions (use Software)",
      "Cloud services (use Software)",
    ],
  },
  "Entertainment & Recreation": {
    description:
      "Entertainment, media subscriptions, recreation, sports, hobbies, events, and streaming services.",
    examples: [
      "Netflix",
      "Spotify",
      "Apple TV+",
      "Apple Music",
      "New York Times",
      "movie tickets",
      "concerts",
      "gym",
    ],
    notThisCategory: [
      "Software tools (use Software)",
      "Video games analytics (use Software)",
    ],
  },
  "Gas & Electric": {
    description: "Utility bills for gas and electricity.",
    examples: ["Seattle City Light", "PSE", "electric bill", "gas bill"],
    notThisCategory: ["Gas station fuel (use Auto & Transport)"],
  },
  Rent: {
    description: "Rent payments for primary residence.",
    examples: ["Monthly rent", "Bilt rent payment"],
    notThisCategory: ["Mortgage payments", "Utility bills (use appropriate utility category)"],
  },
  Insurance: {
    description:
      "Insurance premiums including auto, renters, health, and life insurance.",
    examples: ["USAA", "auto insurance", "renters insurance"],
    notThisCategory: ["Pet insurance (use Pets)"],
  },
  Medical: {
    description:
      "Healthcare costs including doctor visits, pharmacy, therapy, dental, and vision.",
    examples: [
      "Amazon Pharmacy",
      "Shelterwood Collective (therapy)",
      "doctor visits",
      "dental",
    ],
    notThisCategory: [
      "Pet medical (use Pets)",
      "Beauty products (use Shopping)",
    ],
  },
  Pets: {
    description: "All pet-related expenses including food, supplies, insurance, and vet visits.",
    examples: [
      "Embrace Pet Insurance",
      "Whisker",
      "Smallsforsmalls.com",
      "pet food",
      "vet visits",
    ],
    notThisCategory: [],
  },
  Charity: {
    description:
      "Charitable donations, tips, and contributions to nonprofits and open source.",
    examples: [
      "Open Source Collective",
      "GitHub Sponsors",
      "Exercism",
      "nonprofits",
    ],
    notThisCategory: ["Therapy practices (use Medical)"],
  },
  "Furniture & Housewares": {
    description:
      "Furniture, home decor, housewares, candles, and home fragrances.",
    examples: [
      "Room & Board",
      "Apotheke Co",
      "IKEA",
      "West Elm",
      "home decor",
    ],
    notThisCategory: ["Electronics for home (use Electronics)"],
  },
  "Dividends & Capital Gains": {
    description:
      "Investment income including dividends, capital gains, and RSU vesting.",
    examples: [
      "Restricted Stock Lapse",
      "stock dividends",
      "capital gains distributions",
    ],
    notThisCategory: ["401K contributions"],
  },
  Income: {
    description: "Employment income, freelance income, and sales proceeds.",
    examples: [
      "Pinterest payroll",
      "eBay sales",
      "freelance payments",
      "salary deposits",
    ],
    notThisCategory: ["Investment income (use Dividends & Capital Gains)"],
  },
  "Moving Expenses": {
    description: "Costs related to moving homes including movers, truck rental, and packing supplies.",
    examples: ["Gentle Giant West", "U-Haul", "packing supplies"],
    notThisCategory: [],
  },
  "Auto Payment": {
    description: "Car loan payments, lease payments, and vehicle financing.",
    examples: ["Audi USA car payment", "auto loan"],
    notThisCategory: [
      "Auto maintenance/repair (use Auto Maintenance)",
      "Audio equipment companies with 'audio' in name (check carefully)",
    ],
  },
};

export function buildCategoryDefinitions(
  categories: MonarchCategory[],
): CategoryDefinition[] {
  return categories.map((cat) => {
    const meta = CATEGORY_METADATA[cat.name];
    return {
      id: cat.id,
      name: cat.name,
      group: cat.group.name,
      description:
        meta?.description ??
        `Transactions related to ${cat.name.toLowerCase()}.`,
      examples: meta?.examples ?? [],
      notThisCategory: meta?.notThisCategory ?? [],
    };
  });
}

export function formatCategoryDefinitions(
  definitions: CategoryDefinition[],
): string {
  return definitions
    .map((d) => {
      let text = `  - ${d.id}: ${d.name} (${d.group})`;
      text += `\n    ${d.description}`;
      if (d.examples.length > 0) {
        text += `\n    Examples: ${d.examples.join(", ")}`;
      }
      if (d.notThisCategory.length > 0) {
        text += `\n    NOT this category: ${d.notThisCategory.join("; ")}`;
      }
      return text;
    })
    .join("\n");
}
