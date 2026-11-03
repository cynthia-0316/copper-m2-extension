// Module 2: the tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for the first four tools is in specs/module-2/spec.md; the
// fifth, recommend_setup, is the Part 3 extension.
import { tool } from "ai";
import { z } from "zod";
import {
  getPlans,
  getProducts,
  type Plan,
  type ProductId,
} from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      priceUsd: p.priceUsd,
      colors: p.colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map((p) => ({
      id: p.id,
      name: p.name,
      priceUsd: p.priceUsd,
    })),
    plans: getPlans().map((p) => ({
      id: p.id,
      name: p.name,
      monthlyUsd: p.monthlyUsd,
      annualUsd: p.annualUsd,
    })),
  };
}

const productIdSchema = z.enum(["copper-home", "copper-notes"]);

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z.array(productIdSchema).max(5),
  plan: z.enum(["free", "copper-plus"]),
  billing: z.enum(["monthly", "annual"]),
  years: z.number().int().min(1).max(5),
});

const toCents = (usd: number) => Math.round(usd * 100) / 100;

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines: CostBreakdown["lines"] = input.products.map((id) => {
    const product = catalog.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product: ${id}`);
    return { item: product.name, usd: toCents(product.priceUsd) };
  });

  // Copper Plus covers the whole household, so it's one line however many
  // devices there are. The free plan costs nothing, so it adds no line.
  const plan = getPlans().find((p) => p.id === input.plan);
  if (!plan) throw new Error(`Unknown plan: ${input.plan}`);
  if (plan.id !== "free") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    const years = input.years === 1 ? "1 year" : `${input.years} years`;
    lines.push({
      item: `${plan.name}, ${input.billing}, ${years}`,
      usd: toCents(usd),
    });
  }

  const totalUsd = toCents(lines.reduce((sum, line) => sum + line.usd, 0));
  return { lines, totalUsd };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: productIdSchema,
    color: z.string().optional(),
  });

function stockOf(units: number): Stock {
  if (units <= 0) return "backordered";
  return units < 10 ? "low_stock" : "in_stock";
}

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product);
  if (!product) throw new Error(`Unknown product: ${input.product}`);

  // The catalog decides which colors exist, before stock is ever read.
  const wanted = input.color?.trim().toLowerCase();
  if (input.color !== undefined) {
    const known = product.colors.some((c) => c.toLowerCase() === wanted);
    if (!known) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
  }

  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now.",
    };
  }

  // Stock rows name the product ("Copper Notes"), not its id.
  const colors: Extract<Availability, { status: "ok" }>["colors"] = [];
  for (const color of product.colors) {
    if (wanted !== undefined && color.toLowerCase() !== wanted) continue;
    const row = rows.find(
      (r) =>
        r.product === product.name &&
        r.color.toLowerCase() === color.toLowerCase(),
    );
    if (!row) continue;
    const stock = stockOf(row.units_in_stock);
    colors.push({
      color,
      stock,
      restockDate: stock === "backordered" ? row.next_shipment : null,
    });
  }
  return { status: "ok", product: product.name, colors };
}

export type RecommendSetupInput = {
  use: "home" | "meetings" | "lectures" | "both";
  years: number;
  budgetUsd?: number;
};

type Colors = Extract<Availability, { status: "ok" }>["colors"];

export type RecommendedProduct = {
  id: ProductId;
  name: string;
  priceUsd: number;
  /** The catalog feature that fits what the customer wants to do. */
  feature: { name: string; description: string };
  /** Stock for each color, or `null` when stock can't be checked right now. */
  colors: Colors | null;
};

export type SetupOption = {
  plan: Plan["id"];
  name: string;
  totalUsd: number;
  /** `null` when the customer gave no budget. */
  withinBudget: boolean | null;
};

export type SetupRecommendation =
  | {
      status: "ok";
      years: number;
      budgetUsd: number | null;
      products: RecommendedProduct[];
      options: SetupOption[];
      recommended: Plan["id"];
    }
  | {
      status: "over_budget";
      years: number;
      budgetUsd: number;
      products: RecommendedProduct[];
      cheapestTotalUsd: number;
      shortByUsd: number;
    };

export const recommendSetupInput: z.ZodType<RecommendSetupInput> = z.object({
  use: z.enum(["home", "meetings", "lectures", "both"]),
  years: z.number().int().min(1).max(5),
  budgetUsd: z.number().positive().max(10000).optional(),
});

// What each kind of use needs: the product, and the catalog feature that
// answers it. Features are looked up by name, so their wording stays in the
// catalog and is never retyped here.
const SETUPS: Record<
  RecommendSetupInput["use"],
  { id: ProductId; feature: string }[]
> = {
  home: [{ id: "copper-home", feature: "Smart-home control" }],
  meetings: [{ id: "copper-notes", feature: "Meeting Mode" }],
  lectures: [{ id: "copper-notes", feature: "Lecture Mode" }],
  both: [
    { id: "copper-home", feature: "Smart-home control" },
    { id: "copper-notes", feature: "Meeting Mode" },
  ],
};

/**
 * recommend_setup: which devices and plan fit what a customer wants to do,
 * what that costs over some years, and which colors they can get now. Totals
 * come from calculateCost and stock from checkAvailability, so it adds no
 * facts of its own.
 */
export async function recommendSetup(
  input: RecommendSetupInput,
): Promise<SetupRecommendation> {
  const catalog = getProducts();
  const products: RecommendedProduct[] = [];
  for (const { id, feature } of SETUPS[input.use]) {
    const product = catalog.find((p) => p.id === id);
    const found = product?.features.find((f) => f.name === feature);
    if (!product || !found) throw new Error(`Unknown setup: ${id}, ${feature}`);
    const stock = await checkAvailability({ product: id });
    products.push({
      id,
      name: product.name,
      priceUsd: product.priceUsd,
      feature: found,
      colors: stock.status === "ok" ? stock.colors : null,
    });
  }

  const ids = products.map((p) => p.id);
  const options: SetupOption[] = getPlans().map((plan) => {
    const { totalUsd } = calculateCost({
      products: ids,
      plan: plan.id,
      billing: "annual",
      years: input.years,
    });
    return {
      plan: plan.id,
      name: plan.name,
      totalUsd,
      withinBudget:
        input.budgetUsd === undefined ? null : totalUsd <= input.budgetUsd,
    };
  });

  // Free costs the least, so if even that is over budget there is nothing to
  // recommend; say by how much instead.
  const cheapest = Math.min(...options.map((o) => o.totalUsd));
  if (input.budgetUsd !== undefined && cheapest > input.budgetUsd) {
    return {
      status: "over_budget",
      years: input.years,
      budgetUsd: input.budgetUsd,
      products,
      cheapestTotalUsd: cheapest,
      shortByUsd: toCents(cheapest - input.budgetUsd),
    };
  }

  // Copper Plus when it fits (or no budget was given), otherwise the free plan.
  const plus = options.find((o) => o.plan === "copper-plus");
  return {
    status: "ok",
    years: input.years,
    budgetUsd: input.budgetUsd ?? null,
    products,
    options,
    recommended: plus && plus.withinBudget !== false ? "copper-plus" : "free",
  };
}

export const copperTools = {
  get_products: tool({
    description:
      "Lists what Copper sells and which colors each product comes in; use it for 'what colors does it come in?', never for stock.",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Gets the current price of every Copper product and Copper plan, monthly and yearly.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Works out the total cost of up to 5 devices plus a plan (free or Copper Plus), billed monthly or yearly, over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Checks today's stock for a Copper product, for one color or all of them; use it for 'is that color in stock?'.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
  recommend_setup: tool({
    description:
      "Recommends which Copper devices and plan fit what the customer wants to do (at home, meetings, lectures, or both), over 1 to 5 years and an optional budget in dollars. Returns the total cost of each plan and which colors are in stock; use it for 'what should I buy?'.",
    inputSchema: recommendSetupInput,
    execute: async (input) => recommendSetup(input),
  }),
};
