import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Answer } from "@/components/copper/ask-copper-steps";
import type { Progress, ToolStep } from "@/lib/copper/assistant/progress";

afterEach(cleanup);

const done = (steps: ToolStep[], reply = "Here you go."): Progress => ({
  steps,
  reply,
  status: "done",
});

const tool = (name: string, input: unknown, output: unknown): ToolStep => ({
  type: "tool",
  id: `${name}-1`,
  name,
  state: "done",
  input,
  output,
});

describe("Ask Copper tool cards", () => {
  it("shows prices from the tool result, not from the page", () => {
    // Made-up prices that appear nowhere in the catalog.
    const prices = tool(
      "get_prices",
      {},
      {
        products: [
          { id: "copper-home", name: "Copper Home", priceUsd: 987.65 },
        ],
        plans: [
          { id: "free", name: "Free", monthlyUsd: 0, annualUsd: 0 },
          {
            id: "copper-plus",
            name: "Copper Plus",
            monthlyUsd: 12.34,
            annualUsd: 111,
          },
        ],
      },
    );
    render(<Answer progress={done([prices])} tools />);
    const card = within(screen.getByTestId("tool-call"));
    expect(card.getByText("$987.65")).toBeInTheDocument();
    expect(card.getByText("$12.34/mo · $111/yr")).toBeInTheDocument();
    expect(card.queryByText(/\$149|\$79|\$7\.99/)).toBeNull();
  });

  it("shows the cost lines and total from calculate_cost", () => {
    const cost = tool(
      "calculate_cost",
      { products: ["copper-notes"], plan: "free", billing: "annual", years: 3 },
      { lines: [{ item: "Copper Notes", usd: 555.5 }], totalUsd: 555.5 },
    );
    render(<Answer progress={done([cost])} tools />);
    const card = screen.getByTestId("tool-call");
    expect(card.textContent).toContain("Copper Notes");
    expect(card.textContent).toContain("Total");
    expect(card.textContent).toContain("$555.50");
  });

  it("tells a back-ordered color from a color that doesn't exist", () => {
    const stock = tool(
      "check_availability",
      { product: "copper-notes", color: "Night Sky" },
      {
        status: "ok",
        product: "Copper Notes",
        colors: [
          {
            color: "Night Sky",
            stock: "backordered",
            restockDate: "2026-11-14",
          },
        ],
      },
    );
    const missing = {
      ...tool(
        "check_availability",
        { product: "copper-notes", color: "Patina Teal" },
        {
          status: "not_a_color",
          product: "Copper Notes",
          color: "Patina Teal",
          colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
        },
      ),
      id: "check_availability-2",
    };
    render(<Answer progress={done([stock, missing])} tools />);
    const [first, second] = screen.getAllByTestId("tool-call");
    expect(first.textContent).toContain("Back-ordered until Nov 14, 2026");
    expect(second.textContent).toMatch(/doesn't come in Patina Teal/);
    expect(second.textContent).not.toMatch(/Back-ordered|In stock/);
  });

  it("shows a calling tool as still running, with its input unknown", () => {
    const calling: ToolStep = {
      type: "tool",
      id: "c1",
      name: "calculate_cost",
      state: "calling",
    };
    render(
      <Answer
        progress={{ steps: [calling], reply: "", status: "working" }}
        tools
      />,
    );
    expect(screen.getByText(/filling in the details/)).toBeInTheDocument();
    expect(screen.getByText(/the app is running the code/)).toBeInTheDocument();
    expect(screen.getByText("Deciding what to do next…")).toBeInTheDocument();
  });

  it("labels a tools-off answer and draws no tool cards", () => {
    render(<Answer progress={done([], "About $300.")} tools={false} />);
    expect(screen.getByText(/answered without tools/i)).toBeInTheDocument();
    expect(
      screen.getByText(/tools given to copper: none/i),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("tool-call")).toHaveLength(0);
  });

  it("renders bold and code marks in a thinking summary", () => {
    const progress: Progress = {
      steps: [
        { type: "thinking", text: "**Calculating** with `calculate_cost`" },
      ],
      reply: "",
      status: "working",
    };
    render(<Answer progress={progress} tools />);
    const thinking = screen.getByTestId("thinking");
    expect(thinking.querySelector("strong")?.textContent).toBe("Calculating");
    expect(thinking.querySelector("code")?.textContent).toBe("calculate_cost");
    expect(thinking.textContent).not.toContain("**");
  });

  it("draws recommend_setup: the devices, stock, both plans and the pick", () => {
    // Made-up numbers, so they can only have come from the tool result.
    const setup = tool(
      "recommend_setup",
      { use: "lectures", years: 2, budgetUsd: 500 },
      {
        status: "ok",
        years: 2,
        budgetUsd: 500,
        products: [
          {
            id: "copper-notes",
            name: "Copper Notes",
            priceUsd: 321,
            feature: {
              name: "Lecture Mode",
              description: "Notes with key terms.",
            },
            colors: [
              {
                color: "Night Sky",
                stock: "backordered",
                restockDate: "2026-11-14",
              },
              { color: "Desert Sand", stock: "in_stock", restockDate: null },
            ],
          },
        ],
        options: [
          { plan: "free", name: "Free", totalUsd: 321, withinBudget: true },
          {
            plan: "copper-plus",
            name: "Copper Plus",
            totalUsd: 654,
            withinBudget: false,
          },
        ],
        recommended: "free",
      },
    );
    render(<Answer progress={done([setup])} tools />);
    const card = within(screen.getByTestId("tool-call"));
    expect(card.getByText("Copper Notes")).toBeInTheDocument();
    expect(
      card.getByText(/Lecture Mode: Notes with key terms\./),
    ).toBeInTheDocument();
    expect(
      card.getByText("Back-ordered until Nov 14, 2026"),
    ).toBeInTheDocument();
    expect(card.getByText("In stock")).toBeInTheDocument();
    expect(card.getByText("$321 over 2 years")).toBeInTheDocument();
    expect(card.getByText("$654 over 2 years")).toBeInTheDocument();
    // Only the picked plan is marked.
    expect(card.getAllByText("Recommended")).toHaveLength(1);
  });

  it("draws recommend_setup when the budget falls short", () => {
    const setup = tool(
      "recommend_setup",
      { use: "home", years: 1, budgetUsd: 100 },
      {
        status: "over_budget",
        years: 1,
        budgetUsd: 100,
        products: [],
        cheapestTotalUsd: 149,
        shortByUsd: 49,
      },
    );
    render(<Answer progress={done([setup])} tools />);
    const card = screen.getByTestId("tool-call");
    expect(card.textContent).toContain("$100 isn't enough");
    expect(card.textContent).toContain("$149 over 1 year, $49 more.");
    expect(card.textContent).not.toContain("Recommended");
  });
});
