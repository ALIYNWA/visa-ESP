import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PatientForm } from "@/components/PatientForm";

describe("PatientForm", () => {
  it("renders all required fields", () => {
    render(<PatientForm onSubmit={vi.fn()} />);
    expect(screen.getByTestId("patient-pseudonym")).toBeInTheDocument();
    expect(screen.getByTestId("patient-age")).toBeInTheDocument();
    expect(screen.getByTestId("patient-ecog")).toBeInTheDocument();
    expect(screen.getByTestId("patient-submit")).toBeInTheDocument();
  });

  it("shows error when pseudonym is missing", async () => {
    render(<PatientForm onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId("patient-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("error-pseudonym")).toBeInTheDocument();
    });
  });

  it("shows error for invalid age", async () => {
    render(<PatientForm onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByTestId("patient-pseudonym"), "PAT-001");
    await userEvent.type(screen.getByTestId("patient-age"), "200");
    fireEvent.click(screen.getByTestId("patient-submit"));
    await waitFor(() => {
      expect(screen.getByText(/âge doit être entre/i)).toBeInTheDocument();
    });
  });

  it("shows error for invalid ECOG (> 4)", async () => {
    render(<PatientForm onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByTestId("patient-pseudonym"), "PAT-002");
    await userEvent.type(screen.getByTestId("patient-ecog"), "5");
    fireEvent.click(screen.getByTestId("patient-submit"));
    await waitFor(() => {
      expect(screen.getByText(/ECOG doit être entre/i)).toBeInTheDocument();
    });
  });

  it("calls onSubmit with correct payload on valid form", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PatientForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByTestId("patient-pseudonym"), "PAT-TEST-001");
    await userEvent.type(screen.getByTestId("patient-age"), "55");

    fireEvent.click(screen.getByTestId("patient-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          pseudonym: "PAT-TEST-001",
          context: expect.objectContaining({ age: 55 }),
        })
      );
    });
  });

  it("shows loading state", () => {
    render(<PatientForm onSubmit={vi.fn()} isLoading={true} />);
    expect(screen.getByTestId("patient-submit")).toBeDisabled();
    expect(screen.getByTestId("patient-submit")).toHaveTextContent("Enregistrement…");
  });
});
