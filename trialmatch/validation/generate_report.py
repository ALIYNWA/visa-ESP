#!/usr/bin/env python3
"""
TrialMatch — Generate HTML report from validation JSON output.

Usage:
    python validation/generate_report.py --input validation/report.json
"""
import argparse
import json
from pathlib import Path


def generate_html_report(report: dict) -> str:
    go_color = "#16a34a" if report["go_nogo"] == "GO" else "#dc2626"
    rows = ""
    for r in report["results"]:
        status_icon = "✓" if r["passed"] else "✗"
        status_color = "#16a34a" if r["passed"] else "#dc2626"
        rows += f"""
        <tr>
            <td style="color:{status_color};font-weight:bold">{status_icon}</td>
            <td>{r['case_id']}</td>
            <td>{r['trial_id']}</td>
            <td>{r['expected_verdict']}</td>
            <td>{r['actual_verdict']}</td>
            <td>{r['actual_score']}%</td>
            <td>{r['latency_ms']}ms</td>
            <td style="color:#ef4444">{r.get('error') or ''}</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>TrialMatch — Rapport de validation</title>
<style>
  body {{ font-family: system-ui; margin: 40px; color: #1f2937; }}
  h1 {{ color: #1d4ed8; }}
  .summary {{ display: flex; gap: 20px; margin: 20px 0; }}
  .card {{ background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; min-width: 120px; }}
  .card .val {{ font-size: 2em; font-weight: bold; }}
  .go {{ color: {go_color}; font-size: 1.5em; font-weight: bold; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.875em; }}
  th {{ background: #f3f4f6; padding: 8px 12px; text-align: left; border-bottom: 2px solid #e5e7eb; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }}
  tr:hover td {{ background: #f9fafb; }}
</style>
</head>
<body>
<h1>TrialMatch — Rapport de validation</h1>
<p>Run ID : <code>{report['run_id']}</code> · Démarré le {report['started_at'][:19].replace('T', ' ')} UTC</p>

<div class="summary">
  <div class="card"><div class="val">{report['total']}</div>Cas testés</div>
  <div class="card"><div class="val" style="color:#16a34a">{report['passed']}</div>Réussis</div>
  <div class="card"><div class="val" style="color:#dc2626">{report['failed']}</div>Échoués</div>
  <div class="card"><div class="val">{report['pass_rate_pct']}%</div>Taux réussite</div>
  <div class="card"><div class="val">{int(report['avg_latency_ms'])}ms</div>Latence moy.</div>
  <div class="card"><div class="go">{report['go_nogo']}</div>Décision</div>
</div>

<h2>Détail des cas</h2>
<table>
  <thead>
    <tr>
      <th></th>
      <th>Cas</th>
      <th>Essai</th>
      <th>Verdict attendu</th>
      <th>Verdict obtenu</th>
      <th>Score</th>
      <th>Latence</th>
      <th>Erreur</th>
    </tr>
  </thead>
  <tbody>{rows}</tbody>
</table>
</body>
</html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate HTML validation report")
    parser.add_argument("--input", default="validation/report.json")
    parser.add_argument("--output", default="validation/report.html")
    args = parser.parse_args()

    with open(args.input) as f:
        report = json.load(f)

    html = generate_html_report(report)

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Rapport HTML généré : {args.output}")


if __name__ == "__main__":
    main()
