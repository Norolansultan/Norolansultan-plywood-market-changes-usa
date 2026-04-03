"""
fix_ppu.py — Correct price-per-unit (ppu) values in plywood market CSVs.

The "Price per Quantity" row was all zeros. This script:
  1. Reads data/plywood_market_data_cleaned.csv (has Quantity 1 data).
  2. Computes ppu = CIF / Qty, then converts m2 → m3 using board thickness.
  3. Writes corrected ppu values back to row 14 of the cleaned CSV.
  4. Writes zeros to row 13 (Price per Quantity) of the raw CSV (no qty data).
  5. Prints a summary of changes.

Conversion rules
----------------
- If commodity code contains "(m3)"   → use raw CIF/Qty as price per m3
- If commodity code contains "(m2)"   → convert m2 price to m3 using thickness (default 18mm for flooring)
- Products with no unit marker         → ppu = 0 (aggregate heading rows)
- Minimum qty threshold: 50 (micro-shipments → ppu = 0)
- qty == 0 or cif == 0 → ppu = 0
"""

from __future__ import annotations

import csv
import re
import statistics
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
CLEANED_CSV = ROOT / "data" / "plywood_market_data_cleaned.csv"
RAW_CSV     = ROOT / "data" / "plywood_market_data.csv"

MIN_QTY     = 50
DEFAULT_MM  = 12.0
PPU_M3_MIN  = 200.0  # raw ppu below this threshold → treat as m2


class PpuRecord(NamedTuple):
    col_idx: int
    wood: str
    spec: str
    commodity: str
    cif: float
    qty: float
    raw_ppu: float
    thickness_mm: float
    converted: bool   # True  → m2→m3 conversion applied
    ppu: float


def extract_thickness_mm(text: str, is_flooring: bool = False) -> float:
    """Return the first mm value found in *text*.
    Falls back to 18mm for flooring/blockboard, or DEFAULT_MM otherwise."""
    match = re.search(r"(\d+(?:\.\d+)?)\s*mm", text, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return 18.0 if is_flooring else DEFAULT_MM


def compute_ppu(
    spec: str,
    wood: str,
    commodity: str,
    cif: float,
    qty: float,
) -> tuple[float, bool, float]:
    """
    Compute corrected price-per-m3.

    Unit detection priority:
      1. HTS commodity code — explicit (m2) or (m3) marker is authoritative
      2. spec/wood name keywords
      3. ppu < 200 threshold as final fallback

    Thickness: extracted from commodity+spec+wood; flooring/blockboard
    defaults to 18mm; all others to 12mm.

    Returns (ppu, converted, thickness_mm).
    """
    if qty < MIN_QTY or cif == 0:
        return 0.0, False, DEFAULT_MM

    raw_ppu = cif / qty
    all_names = (commodity + " " + spec + " " + wood).lower()
    # Authoritative unit from HTS commodity code
    comm_lower = commodity.lower()
    is_m3 = "(m3)" in comm_lower or "m3" in (spec + " " + wood).lower()
    is_m2 = "(m2)" in comm_lower or "m2" in (spec + " " + wood).lower()

    is_flooring = bool(re.search(r"flooring|blockboard|blb\s", all_names))
    thickness_mm = extract_thickness_mm(commodity + " " + spec + " " + wood, is_flooring)
    thickness_m  = thickness_mm / 1000.0

    # Only return PPU for products explicitly measured in m3.
    # m2 flooring products are a different category — thickness-based
    # conversion is unreliable and inflates values by 2-10x.
    if is_m3:
        return round(raw_ppu, 2), False, thickness_mm

    return 0.0, False, thickness_mm


def process_cleaned_csv() -> list[PpuRecord]:
    """Read cleaned CSV, compute ppu for every data column, return records."""
    with CLEANED_CSV.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))

    row0  = rows[0]   # Commodity (HTS code + name) — authoritative unit marker
    row1  = rows[1]   # Wood Type
    row2  = rows[2]   # Product Specification
    row10 = rows[10]  # CIF Value
    row13 = rows[13]  # Quantity 1 (Cons)
    row14 = rows[14]  # Price per Quantity  ← target

    records: list[PpuRecord] = []

    for i in range(1, len(row1)):
        comm = (row0[i]  if i < len(row0)  else "").strip()
        wood = (row1[i]  if i < len(row1)  else "").strip()
        spec = (row2[i]  if i < len(row2)  else "").strip()
        cif  = float(row10[i]) if i < len(row10) and row10[i].strip() else 0.0
        qty  = float(row13[i]) if i < len(row13) and row13[i].strip() else 0.0

        ppu, converted, thickness_mm = compute_ppu(spec, wood, comm, cif, qty)

        records.append(PpuRecord(
            col_idx=i,
            wood=wood,
            spec=spec,
            commodity=comm,
            cif=cif,
            qty=qty,
            raw_ppu=(cif / qty) if qty >= MIN_QTY and cif > 0 else 0.0,
            thickness_mm=thickness_mm,
            converted=converted,
            ppu=ppu,
        ))

        # Write back into the row (extend if needed)
        while len(row14) <= i:
            row14.append("0")
        row14[i] = str(ppu)

    # Write updated CSV back in-place
    with CLEANED_CSV.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerows(rows)

    return records


def zero_annual_duplicates() -> None:
    """Zero out ppu for annual aggregate rows that are exact CIF+QTY duplicates of a single
    monthly row.  These rows have time strings without a space (e.g. "2023") and their
    CIF and Quantity values are identical to exactly one monthly row, meaning the annual
    figure captures only that one month's shipment — not a true multi-month aggregate.
    Including such rows would double-count prices in downstream aggregations.

    Detection: for each annual row (time has no space) that has a non-zero ppu, build a key
    (country, commodity, cif, qty).  If that key matches exactly one monthly row (time has a
    space), the annual row's ppu is unreliable and is zeroed.
    """
    with CLEANED_CSV.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))

    row0  = rows[0]   # Commodity
    row3  = rows[3]   # Country
    row7  = rows[7]   # Time
    row10 = rows[10]  # CIF
    row13 = rows[13]  # Quantity 1
    row14 = rows[14]  # Price per Quantity

    # Build lookup of (country|commodity|cif|qty) for monthly rows only
    monthly_keys: set[str] = set()
    for i in range(1, len(row7)):
        time = (row7[i] if i < len(row7) else "").strip()
        if " " not in time:
            continue
        ctry = (row3[i]  if i < len(row3)  else "").strip()
        comm = (row0[i]  if i < len(row0)  else "").strip()
        cif  = (row10[i] if i < len(row10) else "").strip()
        qty  = (row13[i] if i < len(row13) else "").strip()
        if cif and qty:
            try:
                if float(cif) > 0 and float(qty) >= MIN_QTY:
                    monthly_keys.add(f"{ctry}|{comm}|{cif}|{qty}")
            except ValueError:
                pass

    zeroed: list[tuple[int, str, str, float]] = []
    for i in range(1, len(row7)):
        time = (row7[i] if i < len(row7) else "").strip()
        if " " in time:  # monthly — skip
            continue
        ppu_s = (row14[i] if i < len(row14) else "").strip()
        try:
            ppu = float(ppu_s)
        except ValueError:
            ppu = 0.0
        if ppu <= 0:
            continue

        ctry = (row3[i]  if i < len(row3)  else "").strip()
        comm = (row0[i]  if i < len(row0)  else "").strip()
        cif  = (row10[i] if i < len(row10) else "").strip()
        qty  = (row13[i] if i < len(row13) else "").strip()
        if cif and qty:
            try:
                if float(cif) > 0 and float(qty) >= MIN_QTY:
                    key = f"{ctry}|{comm}|{cif}|{qty}"
                    if key in monthly_keys:
                        row14[i] = "0"
                        zeroed.append((i, ctry, time, ppu))
            except ValueError:
                pass

    if zeroed:
        with CLEANED_CSV.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.writer(fh)
            writer.writerows(rows)
        print(f"Annual-duplicate zeroing: zeroed {len(zeroed)} row(s).")
        for col, ctry, time, old_ppu in zeroed:
            print(f"  col={col:>5}  {ctry:<20}  {time:<6}  old_ppu={old_ppu:,.2f} -> 0")
    else:
        print("Annual-duplicate zeroing: no rows required correction.")


def zero_raw_ppu() -> None:
    """Write 0 to every data cell in the Price per Quantity row of the raw CSV."""
    with RAW_CSV.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))

    # Find the Price per Quantity row index in the raw CSV
    ppu_row_idx: int | None = None
    for idx, row in enumerate(rows):
        if row and row[0].strip() == "Price per Quantity":
            ppu_row_idx = idx
            break

    if ppu_row_idx is None:
        print("WARNING: 'Price per Quantity' row not found in raw CSV — skipping.")
        return

    ppu_row = rows[ppu_row_idx]
    for i in range(1, len(ppu_row)):
        ppu_row[i] = "0"

    with RAW_CSV.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerows(rows)

    print(f"Raw CSV: wrote zeros to row {ppu_row_idx} (Price per Quantity).")


def print_summary(records: list[PpuRecord]) -> None:
    """Print overall stats and per-wood-type breakdown."""
    updated    = [r for r in records if r.cif > 0]
    with_ppu   = [r for r in records if r.ppu > 0]
    converted  = [r for r in with_ppu if r.converted]
    kept_as_m3 = [r for r in with_ppu if not r.converted]

    ppu_vals = [r.ppu for r in with_ppu]

    print("\n" + "=" * 60)
    print("  PPU FIX SUMMARY")
    print("=" * 60)
    print(f"  Total data columns examined : {len(records)}")
    print(f"  Cells with CIF > 0         : {len(updated)}")
    print(f"  Cells with ppu > 0          : {len(with_ppu)}")
    print(f"  m2->m3 conversions applied  : {len(converted)}")
    print(f"  Kept as-is (m3 / high ppu)  : {len(kept_as_m3)}")
    if ppu_vals:
        print(f"  PPU min  : ${min(ppu_vals):,.2f}")
        print(f"  PPU max  : ${max(ppu_vals):,.2f}")
        print(f"  PPU avg  : ${statistics.mean(ppu_vals):,.2f}")
        print(f"  PPU med  : ${statistics.median(ppu_vals):,.2f}")

    # Per-wood breakdown
    from collections import defaultdict
    wood_groups: dict[str, list[float]] = defaultdict(list)
    wood_conv:   dict[str, int]         = defaultdict(int)

    for r in records:
        key = r.wood or "(blank)"
        if r.ppu > 0:
            wood_groups[key].append(r.ppu)
        if r.converted:
            wood_conv[key] += 1

    print("\n" + "-" * 80)
    print(f"  {'Wood Type':<35} {'Count':>6} {'Min PPU':>10} {'Median':>10} {'Max PPU':>10} {'Conv':>6}")
    print("-" * 80)
    for wood in sorted(wood_groups):
        vals = wood_groups[wood]
        conv = wood_conv.get(wood, 0)
        print(
            f"  {wood:<35} {len(vals):>6} "
            f"${min(vals):>9,.2f} "
            f"${statistics.median(vals):>9,.2f} "
            f"${max(vals):>9,.2f} "
            f"{conv:>6}"
        )
    print("-" * 80)
    print(f"  Column headers: Count=records with ppu>0, Conv=m2->m3 conversions")
    print("=" * 60 + "\n")


def main() -> None:
    print(f"Processing cleaned CSV: {CLEANED_CSV}")
    records = process_cleaned_csv()
    print(f"  Processed {len(records)} data columns.")

    print(f"\nZeroing annual-aggregate rows that duplicate a single monthly row...")
    zero_annual_duplicates()

    print(f"\nProcessing raw CSV: {RAW_CSV}")
    zero_raw_ppu()

    print_summary(records)


if __name__ == "__main__":
    main()
