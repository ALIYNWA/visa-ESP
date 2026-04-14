#!/usr/bin/env python3
"""
TrialMatch Validation Module — Run 100 trial eligibility test cases.

Usage:
    python validation/run_validation.py --fixtures validation/fixtures/sample_trials.json
    python validation/run_validation.py --api-url http://localhost:8000 --token <jwt>
"""
import argparse
import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx


@dataclass
class TestResult:
    case_id: str
    trial_id: str
    expected_verdict: str
    actual_verdict: str
    expected_min_score: int | None
    expected_max_score: int | None
    actual_score: int
    passed: bool
    latency_ms: int
    error: str | None = None


@dataclass
class ValidationRun:
    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    finished_at: str | None = None
    results: list[TestResult] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return self.total - self.passed

    @property
    def pass_rate(self) -> float:
        return (self.passed / self.total * 100) if self.total > 0 else 0.0

    @property
    def avg_latency_ms(self) -> float:
        latencies = [r.latency_ms for r in self.results if not r.error]
        return sum(latencies) / len(latencies) if latencies else 0.0


async def run_validation(
    api_url: str,
    token: str,
    fixtures_path: str,
) -> ValidationRun:
    run = ValidationRun()

    with open(fixtures_path) as f:
        trials = json.load(f)

    async with httpx.AsyncClient(
        base_url=api_url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=300,
    ) as client:
        for trial in trials:
            # Créer le protocole
            protocol_payload = {
                "title": trial["protocol"]["title"],
                "eudract_number": trial["protocol"]["eudract_number"],
                "phase": trial["protocol"]["phase"],
                "pathology": trial["protocol"]["pathology"],
                "criteria": trial["protocol"]["criteria"],
            }

            proto_resp = await client.post("/api/v1/protocols", json=protocol_payload)
            if proto_resp.status_code != 201:
                print(f"[WARN] Failed to create protocol for {trial['trial_id']}: {proto_resp.text}")
                continue

            protocol_id = proto_resp.json()["id"]

            for case in trial["test_cases"]:
                # Créer le patient de test
                pseudonym = f"VAL-{case['case_id']}-{uuid.uuid4().hex[:6]}"
                pat_resp = await client.post(
                    "/api/v1/patients",
                    json={"pseudonym": pseudonym, "context": case["patient_context"]},
                )
                if pat_resp.status_code != 201:
                    run.results.append(TestResult(
                        case_id=case["case_id"],
                        trial_id=trial["trial_id"],
                        expected_verdict=case["expected_verdict"],
                        actual_verdict="error",
                        expected_min_score=case.get("expected_min_score"),
                        expected_max_score=case.get("expected_max_score"),
                        actual_score=0,
                        passed=False,
                        latency_ms=0,
                        error=f"Failed to create patient: {pat_resp.text}",
                    ))
                    continue

                patient_id = pat_resp.json()["id"]

                # Lancer l'analyse
                start = int(time.monotonic() * 1000)
                analysis_resp = await client.post(
                    "/api/v1/analyses",
                    json={"protocol_id": protocol_id, "patient_id": patient_id},
                )
                latency = int(time.monotonic() * 1000) - start

                if analysis_resp.status_code != 201:
                    run.results.append(TestResult(
                        case_id=case["case_id"],
                        trial_id=trial["trial_id"],
                        expected_verdict=case["expected_verdict"],
                        actual_verdict="error",
                        expected_min_score=case.get("expected_min_score"),
                        expected_max_score=case.get("expected_max_score"),
                        actual_score=0,
                        passed=False,
                        latency_ms=latency,
                        error=f"Analysis failed: {analysis_resp.text}",
                    ))
                    continue

                analysis = analysis_resp.json()
                actual_verdict = analysis["verdict"]
                actual_score = analysis["score_pct"]

                # Vérifier le verdict et le score
                verdict_ok = actual_verdict == case["expected_verdict"]
                min_ok = actual_score >= case.get("expected_min_score", 0)
                max_ok = actual_score <= case.get("expected_max_score", 100)
                passed = verdict_ok and min_ok and max_ok

                run.results.append(TestResult(
                    case_id=case["case_id"],
                    trial_id=trial["trial_id"],
                    expected_verdict=case["expected_verdict"],
                    actual_verdict=actual_verdict,
                    expected_min_score=case.get("expected_min_score"),
                    expected_max_score=case.get("expected_max_score"),
                    actual_score=actual_score,
                    passed=passed,
                    latency_ms=latency,
                ))

                status = "✓ PASS" if passed else "✗ FAIL"
                print(
                    f"  {status} | {case['case_id']:<35} | "
                    f"Expected: {case['expected_verdict']:<15} | "
                    f"Got: {actual_verdict:<15} | "
                    f"Score: {actual_score:3}% | {latency}ms"
                )

    run.finished_at = datetime.now(UTC).isoformat()
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="TrialMatch Validation Runner")
    parser.add_argument("--api-url", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--token", required=True, help="JWT access token")
    parser.add_argument(
        "--fixtures",
        default="validation/fixtures/sample_trials.json",
        help="Path to test fixtures JSON",
    )
    parser.add_argument("--output", default="validation/report.json", help="Output report path")
    args = parser.parse_args()

    print(f"\n{'='*70}")
    print(f"  TrialMatch Validation Run — {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*70}\n")

    run = asyncio.run(run_validation(args.api_url, args.token, args.fixtures))

    print(f"\n{'='*70}")
    print(f"  RÉSULTATS : {run.passed}/{run.total} cas réussis ({run.pass_rate:.1f}%)")
    print(f"  Latence moyenne : {run.avg_latency_ms:.0f}ms")

    # Go/No-Go criteria
    if run.pass_rate >= 90:
        print("\n  ✓ GO — Taux de réussite >= 90% (seuil requis)")
    else:
        print(f"\n  ✗ NO-GO — Taux {run.pass_rate:.1f}% < 90% requis")

    print(f"{'='*70}\n")

    # Sauvegarder le rapport
    report = {
        "run_id": run.run_id,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "total": run.total,
        "passed": run.passed,
        "failed": run.failed,
        "pass_rate_pct": round(run.pass_rate, 2),
        "avg_latency_ms": round(run.avg_latency_ms, 0),
        "go_nogo": "GO" if run.pass_rate >= 90 else "NO-GO",
        "results": [
            {
                "case_id": r.case_id,
                "trial_id": r.trial_id,
                "passed": r.passed,
                "expected_verdict": r.expected_verdict,
                "actual_verdict": r.actual_verdict,
                "actual_score": r.actual_score,
                "latency_ms": r.latency_ms,
                "error": r.error,
            }
            for r in run.results
        ],
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Rapport sauvegardé : {output_path}")


if __name__ == "__main__":
    main()
