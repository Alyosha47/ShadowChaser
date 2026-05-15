#!/usr/bin/env python3
"""
verify_dt.py
────────────────────────────────────────────────────────────────────────────
Spot-checks the delta_T formulae in delta_t.py against known reference
values before you run update_dt.py and commit to a full data regen.

Run this first. If you get all green, proceed.

Checks:
  - The 2299 eclipse that triggered this investigation (vs Jubier)
  - SMH 2016 calibration points
  - Boundary continuity at 2050
  - E-M accuracy in the modern era
  - Deep history values vs M-S 2004 table
  - Wrong-polynomial canary (confirms old bug gave ~798s)

Usage:
  python3 verify_dt.py            # failures only
  python3 verify_dt.py --verbose  # all results
────────────────────────────────────────────────────────────────────────────
"""

import argparse
import sys
from delta_t import formula_dt, _em_poly, _smh2016


def run_checks(verbose):
    passed = failed = warnings = 0

    def check(label, got, expected, tol):
        nonlocal passed, failed
        diff = abs(got - expected)
        ok = diff <= tol
        if ok:
            passed += 1
            if verbose:
                print(f'  OK  {label}: got={got:.2f}s  expected={expected:.2f}s  '
                      f'delta={diff:.2f}s')
        else:
            failed += 1
            print(f'  FAIL {label}:')
            print(f'       got={got:.2f}s  expected={expected:.2f}s  '
                  f'delta={diff:.2f}s  (tol={tol}s)')
        return ok

    def warn(label, condition, message):
        nonlocal warnings
        if not condition:
            warnings += 1
            print(f'  WARN {label}: {message}')
        elif verbose:
            print(f'  OK  {label}')

    print('=' * 68)
    print('  verify_dt.py - delta_T formula checks')
    print('=' * 68)

    # ── Primary: the eclipse that triggered this investigation ────────────
    print('\n-- Key calibration point ----------------------------------------\n')
    check('2299 Jun vs Jubier (752.7s)',
          formula_dt(2299), 752.7, 1.0)

    # ── SMH 2016 calibration points ───────────────────────────────────────
    print('\n-- SMH 2016 extrapolation points --------------------------------\n')
    check('2050 (transition)',      formula_dt(2050),  93.0,  1.0)
    check('2100',                  formula_dt(2100), 193.6,  1.0)
    check('2200',                  formula_dt(2200), 442.9,  1.0)
    check('2400',                  formula_dt(2400), 1133.4, 5.0)

    # ── E-M accuracy in the modern/historical era ─────────────────────────
    print('\n-- Espenak-Meeus polynomial (modern era) ------------------------\n')
    check('2000',  formula_dt(2000),  63.8,  1.0)
    check('1900',  formula_dt(1900),  -2.8,  1.0)
    check('1800',  formula_dt(1800),  13.7,  2.0)
    check('1700',  formula_dt(1700),   8.8,  2.0)
    check('1620',  formula_dt(1620),  95.4,  1.0)

    # ── Ancient values vs M-S 2004 table (approximate) ───────────────────
    print('\n-- Ancient history (SMH2016 backward extrapolation) -------------\n')
    # At -500, E-M and M-S 2004 agree to ~14s; SMH2016 backward extrap
    # will differ from both — we just check it's in the right ballpark
    dt_minus500 = formula_dt(-500)
    warn('-500 BCE in reasonable range (15000-19000s)',
         15000 < dt_minus500 < 19000,
         f'got {dt_minus500:.0f}s, expected ~17000s range')
    if verbose:
        print(f'       -500 BCE: {dt_minus500:.0f}s  '
              f'(M-S2004 ref: 17190s, E-M: 17203s)')

    # ── Boundary continuity at 2050 ───────────────────────────────────────
    print('\n-- Boundary continuity at 2050 ----------------------------------\n')
    em_2050  = _em_poly(2050)
    smh_2050 = _smh2016(2050)
    gap = abs(em_2050 - smh_2050)
    warn('E-M/SMH2016 gap at 2050 < 0.1s', gap < 0.1,
         f'gap={gap:.4f}s — formulae have a discontinuity')
    if verbose:
        print(f'       E-M={em_2050:.3f}s  SMH={smh_2050:.3f}s  gap={gap:.4f}s')

    # ── Wrong-polynomial canary ───────────────────────────────────────────
    print('\n-- Wrong-polynomial canary (old bug should give ~798s) ----------\n')
    # E-M blend at 2299: should give ~798s (the broken value from old code)
    t = (2299 - 1820) / 100.0
    old_em_extrap = -20 + 32*t*t - 0.5628*(2150 - 2299)
    check('Old broken E-M at 2299 gives ~798s (confirms bug was real)',
          old_em_extrap, 798.0, 5.0)

    # ── Longitude error summary ───────────────────────────────────────────
    print('\n-- Error quantification -----------------------------------------\n')
    dt_correct = formula_dt(2299)
    dt_old_ms2004 = -20 + 32 * ((2299 - 1820)/100)**2
    dt_old_broken = old_em_extrap
    lon_vs_ms2004 = (dt_correct - dt_old_ms2004) * (360/86400)
    lon_vs_broken = (dt_correct - dt_old_broken) * (360/86400)
    print(f'  Correct (SMH2016) at 2299:     {dt_correct:.1f}s')
    print(f'  Old M-S 2004 parabola at 2299: {dt_old_ms2004:.1f}s  '
          f'(delta={dt_correct - dt_old_ms2004:+.1f}s, '
          f'{lon_vs_ms2004:+.3f} deg lon)')
    print(f'  Old broken E-M at 2299:        {dt_old_broken:.1f}s  '
          f'(delta={dt_correct - dt_old_broken:+.1f}s, '
          f'{lon_vs_broken:+.3f} deg lon)')

    # ── Summary ───────────────────────────────────────────────────────────
    total = passed + failed + warnings
    print('\n' + '=' * 68)
    print(f'  {passed} passed, {failed} failed, {warnings} warnings  '
          f'({total} checks)')
    print('=' * 68)

    if failed:
        print('\n  FAIL - fix delta_t.py before running update_dt.py\n')
        return False
    elif warnings:
        print('\n  WARN - review warnings before running update_dt.py\n')
        return True
    else:
        print('\n  ALL CLEAR - safe to run update_dt.py\n')
        return True


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='show passing checks too')
    args = parser.parse_args()
    ok = run_checks(args.verbose)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
