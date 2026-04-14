import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProtocolForm } from "@/components/ProtocolForm";

describe("ProtocolForm", () => {
  it("renders all required fields", () => {
    render(<ProtocolForm onSubmit={vi.fn()} />);
    expect(screen.getByTestId("protocol-title")).toBeInTheDocument();
    expect(screen.getByTestId("protocol-phase")).toBeInTheDocument();
    expect(screen.getByTestId("protocol-pathology")).toBeInTheDocument();
    expect(screen.getByTestId("protocol-submit")).toBeInTheDocument();
  });

  it("shows validation errors on empty submit", async () => {
    render(<ProtocolForm onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId("protocol-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("error-title")).toBeInTheDocument();
      expect(screen.getByTestId("error-pathology")).toBeInTheDocument();
    });
  });

  it("does not submit when required fields are missing", async () => {
    const onSubmit = vi.fn();
    render(<ProtocolForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("protocol-submit"));
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it("calls onSubmit with correct payload on valid form", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProtocolForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByTestId("protocol-title"), "ONCO-TEST");
    await userEvent.type(screen.getByTestId("protocol-pathology"), "Cancer du poumon");
    await userEvent.selectOptions(screen.getByTestId("protocol-phase"), "II");

    fireEvent.click(screen.getByTestId("protocol-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "ONCO-TEST",
          pathology: "Cancer du poumon",
          phase: "II",
        })
      );
    });
  });

  it("shows isLoading state on submit button", () => {
    render(<ProtocolForm onSubmit={vi.fn()} isLoading={true} />);
    expect(screen.getByTestId("protocol-submit")).toHaveTextContent("Enregistrement…");
    expect(screen.getByTestId("protocol-submit")).toBeDisabled();
  });

  it("respects maxLength on title field", () => {
    render(<ProtocolForm onSubmit={vi.fn()} />);
    expect(screen.getByTestId("protocol-title")).toHaveAttribute("maxLength", "500");
  });
});
