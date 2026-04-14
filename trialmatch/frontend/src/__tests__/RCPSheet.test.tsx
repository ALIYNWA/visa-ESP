import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RCPSheet } from "@/components/RCPSheet";
import type { Analysis } from "@/types";

const mockCriterionResult = {
  id: "cr-1",
  criterion_id: "c-1",
  criterion_text: "Age >= 18 ans",
  criterion_type: "INC" as const,
  status: "satisfait" as const,
  reasoning: "Patient âgé de 55 ans.",
  overridden_by: null,
  overridden_at: null,
  override_note: null,
  override_status: null,
};

const mockAnalysis: Analysis = {
  id: "a-1",
  protocol_id: "p-1",
  protocol_version: 1,
  patient_id: "pat-1",
  verdict: "eligible",
  score_pct: 100,
  resume: "Patient éligible à l'essai.",
  points_attention: [],
  prompt_hash: "abc123def456",
  model_name: "meditron:70b",
  model_version: "70B",
  latency_ms: 2500,
  created_at: "2024-01-15T10:00:00Z",
  created_by: "user-1",
  validated_by: null,
  validated_at: null,
  criterion_results: [mockCriterionResult],
};

describe("RCPSheet", () => {
  it("displays score and verdict", () => {
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={false}
        canOverride={false}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.getByTestId("verdict-badge")).toHaveTextContent("ÉLIGIBLE");
    expect(screen.getByTestId("score-value")).toHaveTextContent("100%");
  });

  it("shows resume text", () => {
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={false}
        canOverride={false}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.getByTestId("analysis-resume")).toHaveTextContent("Patient éligible à l'essai.");
  });

  it("shows criteria table", () => {
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={false}
        canOverride={false}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.getByTestId("criteria-table")).toBeInTheDocument();
    expect(screen.getByText("Age >= 18 ans")).toBeInTheDocument();
  });

  it("shows validate button when canValidate=true and not yet validated", () => {
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={true}
        canOverride={false}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.getByTestId("validate-btn")).toBeInTheDocument();
  });

  it("hides validate button when canValidate=false", () => {
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={false}
        canOverride={false}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.queryByTestId("validate-btn")).not.toBeInTheDocument();
  });

  it("shows validated banner instead of validate button when already validated", () => {
    const validated = {
      ...mockAnalysis,
      validated_at: "2024-01-15T11:00:00Z",
      validated_by: "user-2",
    };
    render(
      <RCPSheet
        analysis={validated}
        canValidate={true}
        canOverride={false}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.getByTestId("validated-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("validate-btn")).not.toBeInTheDocument();
  });

  it("calls onValidate when validate button is clicked", async () => {
    const onValidate = vi.fn().mockResolvedValue(undefined);
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={true}
        canOverride={false}
        onValidate={onValidate}
        onOverride={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(onValidate).toHaveBeenCalled());
  });

  it("shows override button when canOverride=true and not validated", () => {
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={false}
        canOverride={true}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.getByTestId(`override-btn-${mockCriterionResult.id}`)).toBeInTheDocument();
  });

  it("does not show override button when analysis is validated", () => {
    const validated = { ...mockAnalysis, validated_at: "2024-01-15T11:00:00Z", validated_by: "u-2" };
    render(
      <RCPSheet
        analysis={validated}
        canValidate={false}
        canOverride={true}
        onValidate={vi.fn()}
        onOverride={vi.fn()}
      />
    );
    expect(screen.queryByTestId(`override-btn-${mockCriterionResult.id}`)).not.toBeInTheDocument();
  });

  it("opens override modal and calls onOverride on submit", async () => {
    const onOverride = vi.fn().mockResolvedValue(undefined);
    render(
      <RCPSheet
        analysis={mockAnalysis}
        canValidate={false}
        canOverride={true}
        onValidate={vi.fn()}
        onOverride={onOverride}
      />
    );

    fireEvent.click(screen.getByTestId(`override-btn-${mockCriterionResult.id}`));
    expect(screen.getByTestId("override-status-select")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("override-note"), "Raison clinique justifiée.");
    fireEvent.click(screen.getByTestId("override-confirm"));

    await waitFor(() =>
      expect(onOverride).toHaveBeenCalledWith(
        mockCriterionResult.id,
        "satisfait",
        "Raison clinique justifiée."
      )
    );
  });
});
